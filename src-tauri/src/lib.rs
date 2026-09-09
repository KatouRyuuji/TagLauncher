mod commands;
// 集成测试（tests/ 目录把本 crate 当外部 rlib 使用）只能访问 pub 项，
// 故将以下四个模块公开，使其 service/db/model/extension 层可被跨模块链路测试直接调用。
// 仅放宽可见性，不改变任何业务逻辑。
pub mod db;
pub mod extensions;
pub mod models;
pub mod services;

pub use commands::*;
pub use db::Database;

use extensions::mod_loader;
use extensions::mod_registry::ModRegistry;
use services::path_service;
use services::settings_service;
use std::path::PathBuf;
use tauri::Manager;

/// 将旧版数据库以一致快照方式迁移到新位置。
///
/// 旧库可能处于 WAL 模式且存在未 checkpoint 的 `-wal` 旁文件——仅复制主 `.db` 会丢失其中
/// 已提交但未合并的最新事务（经典 WAL 复制陷阱）。改用源库连接的 `VACUUM INTO` 产出单文件
/// 一致快照（含所有已提交改动、无旁文件依赖）。先清理目标及其 WAL/SHM 旁文件，既避免陈旧旁
/// 文件与新快照不匹配导致打开时数据错乱，也满足 `VACUUM INTO` 要求目标文件不存在。
fn migrate_legacy_db(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    let dst_str = dst.to_string_lossy().to_string();
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{}", dst_str, suffix));
    }
    // 优先 VACUUM INTO（一致快照，含未 checkpoint 的 WAL 数据）；以只读方式打开旧库，
    // 避免旧库位于只读位置（Program Files、只读盘）时因无法创建 -shm/-wal 而失败。
    let vacuum_result = rusqlite::Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .and_then(|src_conn| {
        let target = dst_str.replace('\'', "''");
        src_conn.execute_batch(&format!("VACUUM INTO '{}'", target))
    });
    match vacuum_result {
        Ok(_) => Ok(()),
        Err(e) => {
            // 回退：只读打开/VACUUM 失败（如旧库带未 checkpoint 的 -wal，只读无法回放）
            // 时退回普通打开 + VACUUM；再不行用旧的 fs::copy 兜底（只需读权限）。
            eprintln!("[migrate] 只读 VACUUM INTO 失败({})，尝试读写打开后重试", e);
            let retry = rusqlite::Connection::open(src).and_then(|src_conn| {
                let target = dst_str.replace('\'', "''");
                src_conn.execute_batch(&format!("VACUUM INTO '{}'", target))
            });
            match retry {
                Ok(_) => Ok(()),
                Err(e2) => {
                    eprintln!("[migrate] VACUUM INTO 仍失败({})，回退 fs::copy", e2);
                    std::fs::copy(src, dst)
                        .map(|_| ())
                        .map_err(|e3| format!("迁移旧数据库失败 {:?} -> {:?}: {}", src, dst, e3))
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&app_dir).ok();
            let app_paths = path_service::resolve_app_paths(app.handle());
            app_paths.ensure_dirs().map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;

            // 初始化数据库：数据落在 %LOCALAPPDATA%\TagLauncher\Save\（见 path_service）。
            // 若用户来自旧版本（exe 同级 Save/、老 AppData、Program Files MSI 等位置）
            // 首次启动时自动扫描所有历史可能位置，复制最新的健康 db 到当前数据目录
            // （原位置留底不删，历史备份随之一并复制，用户确认无误后可自行清理旧目录）。
            // 仅当当前 db 缺失或为未完成迁移残骸（schema_version=0）时才触发扫描；
            // 真损坏的库不在此覆盖——交给 Database::new 的 open_or_recover 走安全备份
            // 自愈（Backups 恢复 + .corrupt 留存现场），避免被陈旧 legacy 静默回退。
            let db_path = app_paths.save_dir.join("taglauncher.db");
            let db_state = probe_db(&db_path);
            let needs_legacy_scan = matches!(db_state, DbState::Missing | DbState::Debris);
            if needs_legacy_scan {
                if let Some(src) = find_legacy_db(&app_dir, &app_paths.root_dir) {
                    if src != db_path {
                        migrate_legacy_db(&src, &db_path).map_err(|e| {
                            std::io::Error::new(std::io::ErrorKind::Other, e)
                        })?;
                        // 历史安全备份随数据迁移：open_or_recover 自愈只认
                        // 当前数据目录 Backups/ 下的 pre_import/pre_restore 备份
                        if let (Some(src_save), Some(dst_save)) = (src.parent(), db_path.parent()) {
                            migrate_backups(src_save, dst_save);
                        }
                    }
                }
            }
            let database = Database::new(&db_path).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Failed to initialize database: {}", e),
                )
            })?;

            // 初始化 Mod 注册表
            let registry = ModRegistry::new();
            let mods_dir = app_paths.mods_dir.clone();

            let (enabled_mods, enabled_mods_err) = {
                let conn = database.get_conn();
                settings_service::get_enabled_mods(&conn)
            };

            // enabled_mods 解析失败时记录错误，防止误禁所有 mod
            if let Some(err) = enabled_mods_err {
                registry.add_load_error("系统".to_string(), err);
            }

            let app_version = settings_service::get_app_version();
            let (mods, mod_errors) = mod_loader::discover_mods(&mods_dir);

            // 记录 manifest 解析失败的错误
            for err in mod_errors {
                registry.add_load_error(err.dir_name, err.error);
            }

            for (manifest, path) in mods {
                let enabled = enabled_mods.contains(&manifest.id);

                // 校验 min_app_version 和 max_app_version（与 import_mod 同一共用判定）
                let (is_compatible, incompatible_reason) =
                    mod_loader::check_app_version_compat(&manifest, app_version);

                registry.register(manifest, path, enabled, is_compatible, incompatible_reason);
            }

            // ── 依赖兼容性检查 ─────────────────────────────────────────────
            // 所有 mod 注册完成后，检查每个 mod 的 dependencies 和 load_after
            // 是否指向已存在且版本满足的 mod
            {
                let all_mods = registry.list_mods();
                let mod_map: std::collections::HashMap<String, crate::models::ModInfo> =
                    all_mods.iter().map(|m| (m.manifest.id.clone(), m.clone())).collect();

                for mod_info in &all_mods {
                    if !mod_info.is_compatible {
                        continue; // 已标记不兼容的跳过
                    }

                    let mut reasons: Vec<String> = Vec::new();

                    // 检查 dependencies
                    for (dep_id, required_ver) in &mod_info.manifest.dependencies {
                        match mod_map.get(dep_id) {
                            None => {
                                reasons.push(format!(
                                    "依赖 mod '{}' 不存在",
                                    dep_id
                                ));
                            }
                            Some(dep) if !dep.enabled => {
                                reasons.push(format!(
                                    "依赖 mod '{}' 未启用",
                                    dep_id
                                ));
                            }
                            Some(dep) if !mod_loader::semver_satisfies(&dep.manifest.version,
                                required_ver
                            ) => {
                                reasons.push(format!(
                                    "依赖 mod '{}' 版本不满足（需要 {}，实际 {}）",
                                    dep_id, required_ver, dep.manifest.version
                                ));
                            }
                            _ => {}
                        }
                    }

                    // 检查 load_after
                    for after_id in &mod_info.manifest.load_after {
                        if !mod_map.contains_key(after_id) {
                            reasons.push(format!(
                                "前置 mod '{}' 不存在",
                                after_id
                            ));
                        }
                    }

                    if !reasons.is_empty() {
                        registry.mark_incompatible(
                            &mod_info.manifest.id,
                            format!("依赖未满足：{}", reasons.join("；")),
                        );
                    }
                }
            }

            app.manage(database);
            app.manage(registry);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 项目 CRUD
            add_item,
            add_items,
            remove_item,
            remove_items,
            set_many_item_tags,
            update_item_icon,
            get_items,
            get_item,
            get_items_by_ids,
            get_object_file_info,
            list_object_directory,
            get_audio_preview,
            // 标签管理
            get_tags,
            add_tag,
            update_tag,
            remove_tag,
            set_item_tags,
            get_tag_relations,
            add_tag_relation,
            remove_tag_relation,
            // 搜索
            search_items,
            // 启动/打开
            launch_item,
            open_in_explorer,
            open_in_explorer_by_id,
            // 收藏
            toggle_favorite,
            set_favorites,
            // 跨盘符兜底找回
            relocate_missing,
            // 文件柜
            get_cabinets,
            add_cabinet,
            update_cabinet,
            remove_cabinet,
            add_item_to_cabinet,
            remove_item_from_cabinet,
            add_items_to_cabinet,
            remove_items_from_cabinet,
            get_cabinet_items,
            get_cabinet_item_counts,
            // 同义词
            read_synonyms,
            // 设置
            get_app_version,
            get_current_theme,
            set_current_theme,
            get_setting,
            set_setting,
            check_version_migration,
            // 数据目录 / 导入导出备份
            get_data_directory_info,
            set_data_directory,
            reset_data_directory,
            backup_data,
            export_data,
            import_data,
            restart_app,
            // WebDAV 云同步
            sync_get_config,
            sync_set_config,
            sync_clear_password,
            sync_test_connection,
            sync_list_backups,
            sync_backup_now,
            sync_restore,
            // 在线更新检查
            update_check,
            // AI 自动打标
            ai_get_config,
            ai_set_config,
            ai_is_configured,
            ai_clear_api_key,
            ai_test_connection,
            ai_suggest_tags,
            get_custom_themes,
            get_theme_directory_info,
            install_theme_file,
            export_theme_file,
            // Mod 网络原语
            net_fetch,
            // Mod
            get_mods,
            get_mod_load_errors,
            get_mod_content,
            get_mod_dir,
            enable_mod,
            disable_mod,
            delete_mod,
            get_mod_install_state,
            mark_mod_version,
            mod_kv_get,
            mod_kv_set,
            mod_kv_remove,
            mod_records_list,
            mod_record_put,
            mod_record_remove,
            // Mod FS
            read_mod_file,
            read_mod_file_bytes,
            write_mod_file,
            write_mod_file_bytes,
            list_mod_files,
            remove_mod_file,
            // Mod Import/Export
            import_mod,
            export_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 扫描所有可能存放旧版本数据库的位置，返回最近修改的**健康**库。
/// 涵盖：exe 同级 Save/（v1.0~1.7.4 的默认位置）、老 AppData roaming 位置、
/// MSI per-machine 安装位置（Program Files / Program Files (x86)）。
/// 只迁移健康库：候选为残骸/损坏时跳过，避免把坏库复制到新位置，
/// 也避免候选恰为 db_path 自身残骸时遮蔽其他位置的健康旧库。
fn find_legacy_db(app_data_dir: &PathBuf, root_dir: &PathBuf) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. exe 同级 Save/（v1.0~1.7.4 默认位置；升级后数据由此自动复制到用户目录）
    candidates.push(root_dir.join("Save").join("taglauncher.db"));

    // 2. 老 AppData roaming 位置（v1.0.x 之前的默认位置）
    candidates.push(app_data_dir.join("taglauncher.db"));

    // 3. MSI per-machine 安装位置（Program Files\TagLauncher\Save\）
    // 64 位进程下 ProgramFiles 已指向真实 Program Files; ProgramFiles(x86) 用于兼容
    // 32 位安装残留。无需检查 ProgramW6432（在 64 位进程中与 ProgramFiles 重复）。
    for env_key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(pf) = std::env::var(env_key) {
            candidates.push(
                PathBuf::from(pf)
                    .join("TagLauncher")
                    .join("Save")
                    .join("taglauncher.db"),
            );
        }
    }

    candidates
        .into_iter()
        .filter(|p| matches!(probe_db(p), DbState::Healthy))
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

/// 迁移时把旧位置 Backups/ 的历史备份一并复制到新位置（同名文件已存在则跳过，
/// 保留现有）。备份是 open_or_recover 自愈的唯一料源；失败仅记录不阻断启动。
fn migrate_backups(src_save_dir: &std::path::Path, dst_save_dir: &std::path::Path) {
    let src_backups = src_save_dir.join("Backups");
    let entries = match std::fs::read_dir(&src_backups) {
        Ok(e) => e,
        Err(_) => return,
    };
    let dst_backups = dst_save_dir.join("Backups");
    if let Err(e) = std::fs::create_dir_all(&dst_backups) {
        eprintln!("[migrate] 创建备份目录 {:?} 失败({})，跳过历史备份迁移", dst_backups, e);
        return;
    }
    for entry in entries.flatten() {
        let from = entry.path();
        if !from.is_file() {
            continue;
        }
        let to = dst_backups.join(entry.file_name());
        if to.exists() {
            continue;
        }
        if let Err(e) = std::fs::copy(&from, &to) {
            eprintln!("[migrate] 历史备份 {:?} 复制失败: {}", from, e);
        }
    }
}

/// 数据库状态探测（决定启动时走哪条路径）。
#[derive(Debug, PartialEq)]
enum DbState {
    /// 文件不存在 → 触发 legacy 迁移扫描
    Missing,
    /// schema_version > 0 → 直接使用
    Healthy,
    /// 能打开但没有 app_meta 或 schema_version=0 → 未完成迁移的残骸，可被 legacy 覆盖
    Debris,
    /// 打不开或连 sqlite_master 都查询失败 → 真损坏。不做 legacy 覆盖（那会静默回退
    /// 到数月前的旧快照并毁掉现场），交给 open_or_recover 走安全备份自愈
    Corrupt,
}

fn probe_db(db_path: &std::path::Path) -> DbState {
    if !db_path.exists() {
        return DbState::Missing;
    }
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return DbState::Corrupt,
    };
    // 垃圾字节/截断文件 open 也能成功（SQLite 延迟读），sqlite_master 查询才现形
    let has_meta = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='app_meta'",
        [],
        |r| r.get::<_, i64>(0),
    );
    match has_meta {
        Err(_) => DbState::Corrupt,
        Ok(0) => DbState::Debris,
        Ok(_) => {
            let version: u32 = conn
                .query_row(
                    "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if version > 0 {
                DbState::Healthy
            } else {
                DbState::Debris
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn seed_healthy_db(path: &Path) {
        let db = crate::Database::new(path).expect("seed healthy db");
        drop(db);
    }

    fn cleanup(base: &Path) {
        let _ = std::fs::remove_dir_all(base);
    }

    /// find_legacy_db 候选必须覆盖 exe 同级 Save/（v1.0~1.7.4 默认位置）：
    /// 旧版便携/安装用户升级到用户目录数据模型后，数据由该候选被发现并复制。
    #[test]
    fn find_legacy_db_discovers_exe_side_save() {
        let base = std::env::temp_dir().join(format!("tl_legacy_{}", std::process::id()));
        cleanup(&base);
        let root = base.join("root");
        let roaming = base.join("roaming");
        std::fs::create_dir_all(root.join("Save")).unwrap();
        std::fs::create_dir_all(&roaming).unwrap();
        let exe_side = root.join("Save").join("taglauncher.db");
        seed_healthy_db(&exe_side);

        assert_eq!(find_legacy_db(&roaming, &root), Some(exe_side));

        cleanup(&base);
    }

    /// 不健康候选（损坏字节文件）不参与迁移：避免把坏库复制到新位置。
    #[test]
    fn find_legacy_db_skips_corrupt_candidates() {
        let base = std::env::temp_dir().join(format!("tl_legacy_corrupt_{}", std::process::id()));
        cleanup(&base);
        let root = base.join("root");
        let roaming = base.join("roaming");
        std::fs::create_dir_all(root.join("Save")).unwrap();
        std::fs::create_dir_all(&roaming).unwrap();
        std::fs::write(root.join("Save").join("taglauncher.db"), b"junk").unwrap();

        assert_eq!(find_legacy_db(&roaming, &root), None);

        cleanup(&base);
    }

    /// probe_db 三态：缺失 / 垃圾字节损坏 / 空库残骸 / 正常健康。
    #[test]
    fn probe_db_distinguishes_missing_corrupt_debris_healthy() {
        let base = std::env::temp_dir().join(format!("tl_probe_{}", std::process::id()));
        cleanup(&base);
        std::fs::create_dir_all(&base).unwrap();

        let missing = base.join("missing.db");
        assert_eq!(probe_db(&missing), DbState::Missing);

        let corrupt = base.join("corrupt.db");
        std::fs::write(&corrupt, b"not a sqlite database at all").unwrap();
        assert_eq!(probe_db(&corrupt), DbState::Corrupt);

        let debris = base.join("debris.db");
        rusqlite::Connection::open(&debris).unwrap(); // 空库：无 app_meta
        assert_eq!(probe_db(&debris), DbState::Debris);

        let healthy = base.join("healthy.db");
        seed_healthy_db(&healthy);
        assert_eq!(probe_db(&healthy), DbState::Healthy);

        cleanup(&base);
    }

    /// migrate_legacy_db 主路径：VACUUM INTO 一致快照复制数据，
    /// 并清理目标处残留的 WAL/SHM 旁文件（防止陈旧旁文件与新快照不匹配）。
    #[test]
    fn migrate_legacy_db_copies_data_and_clears_stale_sidecars() {
        let base = std::env::temp_dir().join(format!("tl_migrate_{}", std::process::id()));
        cleanup(&base);
        std::fs::create_dir_all(&base).unwrap();
        let src = base.join("src.db");
        let dst = base.join("dst.db");

        // 播种源库数据
        {
            let db = crate::Database::new(&src).expect("seed src");
            db.get_conn()
                .execute("INSERT INTO items (name, path, type) VALUES ('migrated', 'D:\\\\m.exe', 'exe')", [])
                .unwrap();
        }
        // 目标处放残骸：既有文件 + 陈旧 WAL 旁文件
        std::fs::write(&dst, b"leftover").unwrap();
        let dst_wal = format!("{}-wal", dst.to_string_lossy());
        std::fs::write(&dst_wal, b"stale wal").unwrap();

        migrate_legacy_db(&src, &dst).expect("migrate");

        assert!(!Path::new(&dst_wal).exists(), "陈旧 WAL 旁文件应被清理");
        let conn = rusqlite::Connection::open(&dst).unwrap();
        let name: String = conn
            .query_row("SELECT name FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "migrated");

        cleanup(&base);
    }
}

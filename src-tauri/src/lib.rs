mod commands;
mod db;
mod extensions;
mod models;
mod services;

pub use commands::*;
pub use db::Database;

use extensions::mod_loader;
use extensions::mod_registry::ModRegistry;
use services::path_service;
use services::settings_service;
use std::path::PathBuf;
use tauri::Manager;

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

            // 初始化数据库：新架构使用 Save/ 存放应用原生数据。
            // 若用户来自旧版本（AppData/Program Files MSI 安装等位置）首次启动时自动
            // 扫描所有历史可能位置，复制最新修改的 db 到 Save/。
            // 若当前 db 是历史失败启动留下的未完成迁移残骸（schema_version=0），
            // 也尝试重新扫描历史位置覆盖之，避免要求用户手动清理。
            let db_path = app_paths.save_dir.join("taglauncher.db");
            let needs_legacy_scan = !db_path.exists() || !is_db_healthy(&db_path);
            if needs_legacy_scan {
                if let Some(src) = find_legacy_db(&app_dir) {
                    if src != db_path {
                        std::fs::copy(&src, &db_path).map_err(|e| {
                            std::io::Error::new(
                                std::io::ErrorKind::Other,
                                format!("Failed to migrate database from {:?}: {}", src, e),
                            )
                        })?;
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

                // 校验 min_app_version 和 max_app_version
                let (is_compatible, incompatible_reason) = {
                    // 1. 检查最低版本要求
                    let min_ok = match manifest.min_app_version.as_deref() {
                        None => Ok(()),
                        Some(required) => {
                            if mod_loader::semver_gte(app_version, required) {
                                Ok(())
                            } else {
                                Err(format!(
                                    "需要 App >= {}，当前版本为 {}",
                                    required, app_version
                                ))
                            }
                        }
                    };
                    // 2. 检查最高版本限制（app_version > max → 不兼容）
                    let max_ok = match manifest.max_app_version.as_deref() {
                        None => Ok(()),
                        Some(max) => {
                            if mod_loader::semver_gte(max, app_version) {
                                Ok(())
                            } else {
                                Err(format!(
                                    "此 mod 不兼容 App >= {}，当前版本为 {}",
                                    max, app_version
                                ))
                            }
                        }
                    };
                    match (min_ok, max_ok) {
                        (Ok(()), Ok(())) => (true, None),
                        (Err(e), _) => (false, Some(e)),
                        (_, Err(e)) => (false, Some(e)),
                    }
                };

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
            // 搜索
            search_items,
            // 启动/打开
            launch_item,
            open_in_explorer,
            open_in_explorer_by_id,
            // 收藏
            toggle_favorite,
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
            // 同义词
            read_synonyms,
            // 设置
            get_app_version,
            get_current_theme,
            set_current_theme,
            get_setting,
            set_setting,
            get_custom_themes,
            get_theme_directory_info,
            install_theme_file,
            export_theme_file,
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

/// 扫描所有可能存放旧版本数据库的位置，返回最近修改的那个。
/// 涵盖：老 AppData 路径、MSI per-machine 安装位置（Program Files / Program Files (x86)）。
fn find_legacy_db(app_data_dir: &PathBuf) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. 老 AppData roaming 位置（v1.0.x 之前的默认位置）
    candidates.push(app_data_dir.join("taglauncher.db"));

    // 2. MSI per-machine 安装位置（Program Files\TagLauncher\Save\）
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
        .filter(|p| p.exists())
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

/// 判断数据库是否完成过初始化迁移（app_meta.schema_version > 0）。
/// 返回 false 表示这是个空 / 未迁移 / 损坏的 db，可以安全地被 legacy 覆盖。
fn is_db_healthy(db_path: &std::path::Path) -> bool {
    // 防御：Connection::open 对不存在路径会创建空 db，故先校验存在性。
    if !db_path.exists() {
        return false;
    }
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let version: u32 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    version > 0
}

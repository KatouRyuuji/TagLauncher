// ============================================================================
// data_commands.rs — 数据目录 / 导入 / 导出 / 备份
// ============================================================================
// 设计要点：
// - 导出/备份/迁移统一走 SQLite Online Backup API（rusqlite backup feature），
//   页级一致快照，不受 WAL 未 checkpoint、文件句柄占用影响。
// - 数据目录重定向存放在 exe 旁 datapath.json（见 path_service），因为"数据在哪"
//   这一指针不能存在数据库自身内。切换目录 / 导入数据后需重启应用生效。
// - 导入前自动把当前库备份到 Backups/，操作可回退。
// ============================================================================

use crate::db::Database;
use crate::services::path_service;
use rusqlite::backup::Backup;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::State;

const DB_FILE_NAME: &str = "taglauncher.db";
const BACKUPS_DIR_NAME: &str = "Backups";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectoryInfo {
    /// 当前生效的数据目录
    pub save_dir: String,
    /// 默认数据目录（exe 同级 Save/）
    pub default_save_dir: String,
    /// 是否使用了自定义目录
    pub is_custom: bool,
    /// 数据库文件大小（字节，文件缺失时为 0）
    pub db_size_bytes: u64,
    /// 备份目录
    pub backups_dir: String,
}

#[tauri::command]
pub fn get_data_directory_info(app: tauri::AppHandle) -> DataDirectoryInfo {
    let paths = path_service::resolve_app_paths(&app);
    let default_dir = path_service::default_save_dir(&paths.root_dir);
    let db_path = paths.save_dir.join(DB_FILE_NAME);
    DataDirectoryInfo {
        save_dir: paths.save_dir.to_string_lossy().to_string(),
        default_save_dir: default_dir.to_string_lossy().to_string(),
        is_custom: paths.save_dir != default_dir,
        db_size_bytes: std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0),
        backups_dir: paths
            .save_dir
            .join(BACKUPS_DIR_NAME)
            .to_string_lossy()
            .to_string(),
    }
}

/// 切换数据目录。migrate=true 时把当前数据库快照到新目录；
/// 新目录已存在数据库时拒绝迁移覆盖（改用 migrate=false 直接采用该库）。
/// 返回后需要重启应用才能生效。
/// migrate=true 时会整库快照到新目录（阻塞），故用 (async) 放到工作线程；
/// DB 锁只在同步的 snapshot_live_db 小段内持有并随即释放，无跨 await 持锁。
#[tauri::command(async)]
pub fn set_data_directory(
    app: tauri::AppHandle,
    db: State<Database>,
    new_dir: String,
    migrate: bool,
) -> Result<(), String> {
    let paths = path_service::resolve_app_paths(&app);
    let raw_dir = PathBuf::from(new_dir.trim());
    if raw_dir.as_os_str().is_empty() {
        return Err("目标目录不能为空".to_string());
    }
    // 相对路径一律锚定到应用根目录：否则创建目录按当前 CWD 解析、重启后
    // read_data_dir_redirect 又按新 CWD 解析，数据目录随启动方式漂移。
    let new_dir = if raw_dir.is_absolute() {
        raw_dir
    } else {
        paths.root_dir.join(raw_dir)
    };
    if new_dir == paths.save_dir {
        return Err("目标目录与当前数据目录相同".to_string());
    }

    std::fs::create_dir_all(&new_dir).map_err(|e| format!("无法创建目标目录: {}", e))?;

    // 可写性探测
    let probe = new_dir.join(".taglauncher_write_probe");
    std::fs::write(&probe, b"probe").map_err(|e| format!("目标目录不可写: {}", e))?;
    std::fs::remove_file(&probe).ok();

    let target_db = new_dir.join(DB_FILE_NAME);
    if migrate {
        if target_db.exists() {
            return Err(
                "目标目录已存在 TagLauncher 数据库。若要使用该目录中的数据，请选择“直接使用目标目录数据”。"
                    .to_string(),
            );
        }
        snapshot_live_db(&db, &target_db)?;
    } else if target_db.exists() {
        // 采用目标目录已有库：先校验它是合法的 TagLauncher 库，
        // 否则重定向后下次启动会因损坏/不兼容库直接起不来。
        let source_version = validate_importable_db(&target_db)?;
        let current_version = crate::db::live_schema_version(&db);
        if current_version > 0 && source_version > current_version {
            return Err(format!(
                "目标目录中的数据库 schema 版本(v{})高于当前应用支持的版本(v{})，请升级 TagLauncher 后再使用该目录",
                source_version, current_version
            ));
        }
    }

    // 默认目录则清除重定向文件，否则写入
    let default_dir = path_service::default_save_dir(&paths.root_dir);
    let redirect = if new_dir == default_dir { None } else { Some(new_dir.as_path()) };
    path_service::write_data_dir_redirect(&paths.root_dir, redirect)?;
    Ok(())
}

/// 恢复默认数据目录（exe 同级 Save/）。返回后需重启生效。
#[tauri::command]
pub fn reset_data_directory(app: tauri::AppHandle) -> Result<(), String> {
    let paths = path_service::resolve_app_paths(&app);
    path_service::write_data_dir_redirect(&paths.root_dir, None)
}

/// 一键备份：把当前库快照到 Save/Backups/taglauncher_backup_<UTC时间戳>.db，返回备份文件路径。
/// 本机灾备：**不剔除敏感配置**，保留完整数据（含 AI 密钥）以支持从备份完整恢复。
/// Backups/ 位于本机 Save/ 内，安全面等同主库（主库本就明文存密钥），保留不扩大泄露面；
/// 真正的对外分享出口是 export_data，那里才剔除密钥。
#[tauri::command(async)]
pub fn backup_data(app: tauri::AppHandle, db: State<Database>) -> Result<String, String> {
    let paths = path_service::resolve_app_paths(&app);
    let backups_dir = paths.save_dir.join(BACKUPS_DIR_NAME);
    std::fs::create_dir_all(&backups_dir).map_err(|e| format!("无法创建备份目录: {}", e))?;

    let target = backups_dir.join(format!("taglauncher_backup_{}.db", utc_timestamp_compact()));
    snapshot_live_db(&db, &target)?;
    Ok(target.to_string_lossy().to_string())
}

/// 导出数据：把当前库快照到用户指定的 .db 文件（副本剔除敏感键，供安全分享）。
/// 阻塞式整库拷贝，用 (async) 放到工作线程；DB 锁只在同步的 snapshot 小段内持有并随即释放。
#[tauri::command(async)]
pub fn export_data(
    app: tauri::AppHandle,
    db: State<Database>,
    target_path: String,
) -> Result<(), String> {
    let target = PathBuf::from(target_path.trim());
    if target.as_os_str().is_empty() {
        return Err("导出路径不能为空".to_string());
    }
    // 防御：目标就是实库自身时，Backup 自拷贝会静默"成功"（no-op），误导用户以为导出了数据。
    let live_path = path_service::resolve_app_paths(&app).save_dir.join(DB_FILE_NAME);
    if target == live_path {
        return Err("导出目标不能是当前正在使用的数据库文件".to_string());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建导出目录: {}", e))?;
    }
    snapshot_live_db(&db, &target)?;
    strip_sensitive_keys(&target)
}

/// 导入数据：校验来源库 → 自动备份当前库 → 覆盖当前库文件。
/// 返回自动备份文件路径。调用方应在成功后立即重启应用。
/// 阻塞式整库拷贝，用 (async) 放到工作线程；DB 锁只在同步的快照/覆盖小段内持有并随即释放
/// （函数体无 await）。覆盖中途失败会**自动用安全备份回滚**实库，避免半成品损坏数据。
#[tauri::command(async)]
pub fn import_data(
    app: tauri::AppHandle,
    db: State<Database>,
    source_path: String,
) -> Result<String, String> {
    let source = PathBuf::from(source_path.trim());
    let source_version = validate_importable_db(&source)?;

    // 防御：来源就是实库自身时，"先快照安全备份 → 再覆盖实库"会变成自己灌自己（no-op），
    // 用户以为导入了数据其实什么都没发生（与 export 侧 :153 的自身防御同理）。
    let live_path = path_service::resolve_app_paths(&app).save_dir.join(DB_FILE_NAME);
    if source == live_path {
        return Err("导入来源不能是当前正在使用的数据库文件".to_string());
    }

    // 版本区间校验：来源库 schema 不得高于当前应用支持的版本（= 当前实库已迁移到的版本），
    // 否则导入后可能触发不兼容 / 破坏性迁移。
    let current_version = crate::db::live_schema_version(&db);
    if current_version > 0 && source_version > current_version {
        return Err(format!(
            "来源库 schema 版本(v{})高于当前应用支持的版本(v{})，请升级 TagLauncher 后再导入",
            source_version, current_version
        ));
    }

    // 导入前自动备份当前库（可回退）
    let paths = path_service::resolve_app_paths(&app);
    let backups_dir = paths.save_dir.join(BACKUPS_DIR_NAME);
    std::fs::create_dir_all(&backups_dir).map_err(|e| format!("无法创建备份目录: {}", e))?;
    let safety_backup =
        backups_dir.join(format!("taglauncher_pre_import_{}.db", utc_timestamp_compact()));
    snapshot_live_db(&db, &safety_backup)?;

    // 用 Backup API 把来源库内容灌入"当前打开的连接"（避免 Windows 文件占用/页缓存不一致）。
    // 一旦覆盖失败，立即用安全备份把实库回滚到导入前状态，再返回错误。
    if let Err(e) = overwrite_live_from(&db, &source) {
        return match overwrite_live_from(&db, &safety_backup) {
            Ok(()) => Err(format!("导入失败，已自动回滚到导入前状态：{}", e)),
            Err(re) => Err(format!(
                "导入失败且自动回滚也失败：{}（原始错误：{}）。可手动用安全备份恢复：{}",
                re,
                e,
                safety_backup.to_string_lossy()
            )),
        };
    }

    Ok(safety_backup.to_string_lossy().to_string())
}

/// 重启应用（数据目录切换 / 导入完成后调用）。
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/// 把当前打开的库在线快照到目标文件（页级一致，不依赖 WAL checkpoint）。
/// pub 以便集成测试验证备份/导出的整库快照原语（命令层带 State，测其内部逻辑函数）。
pub fn snapshot_live_db(db: &Database, target: &Path) -> Result<(), String> {
    let live = db.get_conn();
    let mut dst =
        Connection::open(target).map_err(|e| format!("无法创建目标数据库 {:?}: {}", target, e))?;
    let backup = Backup::new(&live, &mut dst).map_err(|e| format!("备份失败: {}", e))?;
    run_backup_with_timeout(&backup).map_err(|e| format!("备份失败: {}", e))
}

/// 执行 Backup 并带累计超时。
/// rusqlite 的 run_to_completion 对 Busy/Locked 无限重试：目标文件被其它进程持久占用
/// （另一实例打开、杀软长锁、目标在离线网络盘）时永不返回，且整个 Backup 期间持有全局
/// DB 锁 → 所有数据命令死锁，只能杀进程。改为手写 step 循环，超时即报错并释放锁。
fn run_backup_with_timeout(backup: &Backup) -> Result<(), String> {
    use rusqlite::backup::StepResult;
    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
    let start = std::time::Instant::now();
    loop {
        match backup.step(64) {
            Ok(StepResult::Done) => return Ok(()),
            Ok(StepResult::More) => {}
            Ok(StepResult::Busy) | Ok(StepResult::Locked) => {
                if start.elapsed() > TIMEOUT {
                    return Err("目标数据库正被其它程序占用，操作超时（请关闭占用方后重试）".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Ok(_) => {} // non_exhaustive：未来新增变体按未完成继续轮询
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// 从**对外导出**副本中剔除敏感配置（AI 密钥、WebDAV 凭据等），避免密钥随可分享的 .db 外泄。
/// 剔除范围与 is_sensitive_setting_key / strip_cloud_secrets 保持一致（ai.* 与 sync.*）：
/// sync.password 同为明文凭据，缺一即形成脱敏旁路。
/// 仅 export_data（用户主动导出到任意路径，真正的分享出口）调用；
/// backup_data（本机灾备）、import 的 safety_backup、数据目录迁移均保留密钥以支持完整恢复。
/// DELETE 后立即 VACUUM 重写文件，确保密钥明文不残留在被释放的空闲页里（否则可被 strings/hex 还原）。
/// pub 以便集成测试验证导出副本已剔除 ai.*/sync.* 且明文不残留于文件字节。
pub fn strip_sensitive_keys(db_file: &Path) -> Result<(), String> {
    let conn = Connection::open(db_file)
        .map_err(|e| format!("无法打开副本以清理敏感配置: {}", e))?;
    conn.execute_batch(
        "DELETE FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'; VACUUM;",
    )
    .map_err(|e| format!("清理敏感配置失败: {}", e))?;
    Ok(())
}

/// 用来源库内容覆盖当前打开的库（Backup API，页级一致）。用于导入及导入失败回滚。
/// 只在内部短暂持有 db 锁，调用方保证前后不重叠持锁。
/// pub 以便集成测试验证导入覆盖与"从安全备份回滚"这一原语。
pub fn overwrite_live_from(db: &Database, source: &Path) -> Result<(), String> {
    let src_conn = Connection::open_with_flags(source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("无法打开来源数据库: {}", e))?;
    let mut live = db.get_conn();
    let backup = Backup::new(&src_conn, &mut live).map_err(|e| format!("覆盖失败: {}", e))?;
    run_backup_with_timeout(&backup).map_err(|e| format!("覆盖失败: {}", e))
}

/// 校验待导入文件是一个完成过初始化迁移的 TagLauncher 库，返回其 schema_version。
/// pub 以便集成测试验证导入前的版本校验（非 db/缺 schema_version 拒绝、合法库返回版本号）。
pub fn validate_importable_db(source: &Path) -> Result<u32, String> {
    if !source.exists() {
        return Err("来源文件不存在".to_string());
    }
    let conn = Connection::open_with_flags(source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("无法打开来源文件（不是有效的 SQLite 数据库？）: {}", e))?;
    let version: u32 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if version == 0 {
        return Err("来源文件不是有效的 TagLauncher 数据库（缺少 schema_version）".to_string());
    }
    Ok(version)
}

/// UTC 时间戳（YYYYMMDD_HHMMSS_mmm，毫秒后缀避免同秒多次备份互相覆盖），无第三方依赖的民用历法换算。
/// pub(crate) 供 sync_commands 命名云端备份文件（同一时间戳格式，本地/云端备份可互相对照）。
pub(crate) fn utc_timestamp_compact() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let secs = (millis / 1000) as u64;
    let ms = millis % 1000;
    let days = (secs / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    let rem = secs % 86_400;
    format!(
        "{:04}{:02}{:02}_{:02}{:02}{:02}_{:03}",
        year,
        month,
        day,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        ms
    )
}

/// Howard Hinnant 的 days→civil 算法（公历，1970-01-01 为第 0 天）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_days_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1)); // 2024-01-01
        assert_eq!(civil_from_days(20_635), (2026, 7, 1)); // 2026-07-01
    }

    #[test]
    fn validate_rejects_non_db_file() {
        let mut p = std::env::temp_dir();
        p.push(format!("tl_not_a_db_{}.txt", std::process::id()));
        std::fs::write(&p, "hello world, definitely not sqlite").unwrap();
        assert!(validate_importable_db(&p).is_err());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn validate_rejects_missing_file() {
        assert!(validate_importable_db(Path::new("Z:/definitely/missing.db")).is_err());
    }

    #[test]
    fn validate_returns_schema_version() {
        let mut p = std::env::temp_dir();
        p.push(format!("tl_validate_ver_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let conn = Connection::open(&p).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO app_meta VALUES ('schema_version', '7');",
            )
            .unwrap();
        }
        assert_eq!(validate_importable_db(&p).unwrap(), 7);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn strip_sensitive_keys_removes_ai_and_sync_keys() {
        let mut p = std::env::temp_dir();
        p.push(format!("tl_strip_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let conn = Connection::open(&p).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO app_meta VALUES ('ai.api_key', 'sk-secret');
                 INSERT INTO app_meta VALUES ('ai.base_url', 'https://x');
                 INSERT INTO app_meta VALUES ('sync.password', 'dav-secret');
                 INSERT INTO app_meta VALUES ('sync.webdav_url', 'https://dav');
                 INSERT INTO app_meta VALUES ('theme', 'dark');",
            )
            .unwrap();
        }

        strip_sensitive_keys(&p).expect("strip should succeed");

        let conn = Connection::open(&p).unwrap();
        let secret_cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let theme_cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_meta WHERE key = 'theme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(secret_cnt, 0, "ai.*/sync.* 敏感键应被清除");
        assert_eq!(theme_cnt, 1, "非敏感键应保留");
        drop(conn);
        let _ = std::fs::remove_file(&p);
    }
}

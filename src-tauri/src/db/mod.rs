pub mod connection;
pub mod migrations;
pub mod schema;

pub use connection::Database;

use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, Ordering};

/// 写入冻结标志：切换数据目录 / 导入数据 / 云端恢复成功后、重启前的窗口内，
/// 对旧库的一切写入都将在重启后丢失，故冻结并由各写入口统一报错（读不受影响）。
/// 用全局标志而非 Database 实例字段：service 层写路径只持有 &Connection，拿不到实例。
static WRITES_FROZEN: AtomicBool = AtomicBool::new(false);

/// 冻结后各写入口的统一报错文案。
pub(crate) const WRITES_FROZEN_MSG: &str = "操作已完成，请重启应用生效";

/// 冻结写入（仅 data/sync 命令在切换/导入/恢复成功后调用）。
pub fn freeze_writes() {
    WRITES_FROZEN.store(true, Ordering::SeqCst);
}

/// 当前是否处于写入冻结窗口。
pub fn writes_frozen() -> bool {
    WRITES_FROZEN.load(Ordering::SeqCst)
}

/// 写命令 / 写 service 入口检查：冻结后拒绝写入。
pub(crate) fn ensure_writes_allowed() -> Result<(), String> {
    if writes_frozen() {
        Err(WRITES_FROZEN_MSG.to_string())
    } else {
        Ok(())
    }
}

/// 判断表是否含某列（供 schema 与各迁移条件创建依赖该列的索引/DDL 复用）。
/// 表名/列名均为代码内常量、非用户输入，故此处 format! 拼接无 SQL 注入风险。
pub(crate) fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'",
        table, column
    ))
    .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
    .unwrap_or(0)
        > 0
}

/// 读取当前实库的 schema_version（= 本应用支持的最高版本，实库启动时已迁移到最新）。
/// data_commands（导入/换目录）与 sync_commands（云端恢复）共用同一份实现，
/// 避免两处各自复制、日后口径漂移。
pub(crate) fn live_schema_version(db: &Database) -> u32 {
    let conn = db.get_conn();
    conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// 从副本文件中物理剔除敏感配置（ai.*/sync.*）并 VACUUM 重写。
/// 对外导出（data_commands::strip_sensitive_keys）与云端副本（sync_commands::strip_cloud_secrets）
/// 共用同一份实现，避免两处各自复制、剔除口径日后漂移。
/// VACUUM 重写文件，确保密钥明文不残留在被释放的空闲页（否则可被 strings/hex 还原）。
pub(crate) fn strip_sensitive_keys_in_file(db_file: &std::path::Path) -> Result<(), String> {
    let conn = Connection::open(db_file)
        .map_err(|e| format!("无法打开副本以清理敏感配置: {}", e))?;
    conn.execute_batch(
        "DELETE FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'; VACUUM;",
    )
    .map_err(|e| format!("清理敏感配置失败: {}", e))?;
    Ok(())
}

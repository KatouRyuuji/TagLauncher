pub mod connection;
pub mod migrations;
pub mod schema;

pub use connection::Database;

use rusqlite::Connection;

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

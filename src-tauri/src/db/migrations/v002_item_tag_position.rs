use super::Migration;
use rusqlite::Connection;

/// 为项目标签关联增加展示顺序字段。
pub struct V002ItemTagPosition;

impl Migration for V002ItemTagPosition {
    fn version(&self) -> u32 {
        2
    }

    fn description(&self) -> &str {
        "Add item tag display position"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !has_column(conn, "item_tags", "position") {
            conn.execute_batch("ALTER TABLE item_tags ADD COLUMN position INTEGER NOT NULL DEFAULT 0")?;
        }
        Ok(())
    }
}

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'",
        table, column,
    ))
    .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
    .unwrap_or(0)
        > 0
}

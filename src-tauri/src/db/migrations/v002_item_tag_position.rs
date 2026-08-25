use super::Migration;
use crate::db::has_column;
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
        // 与 v001 第 4 步重复是有意的幂等兜底：两处都有 has_column 前置检查，
        // 只应用过其中一版的历史库也能收敛到含 position 列的状态；新库上第二处为 no-op。
        if !has_column(conn, "item_tags", "position") {
            conn.execute_batch("ALTER TABLE item_tags ADD COLUMN position INTEGER NOT NULL DEFAULT 0")?;
        }
        Ok(())
    }
}

// has_column 复用 crate::db::has_column（见 db/mod.rs）。

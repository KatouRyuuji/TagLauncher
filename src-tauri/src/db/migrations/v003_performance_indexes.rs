use super::Migration;
use rusqlite::Connection;

/// 为高频筛选和批量读取路径补齐索引。
pub struct V003PerformanceIndexes;

impl Migration for V003PerformanceIndexes {
    fn version(&self) -> u32 {
        3
    }

    fn description(&self) -> &str {
        "Add performance indexes for item tags and cabinet items"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_item_tags_tag_item
                ON item_tags(tag_id, item_id);

            CREATE INDEX IF NOT EXISTS idx_item_tags_item_position
                ON item_tags(item_id, position);

            CREATE INDEX IF NOT EXISTS idx_cabinet_items_item
                ON cabinet_items(item_id);
            "#,
        )
    }
}

use super::Migration;
use rusqlite::Connection;

/// 标签层级关系（图状，非树状）：一个标签可有多个父标签（多继承），构成有向无环图(DAG)。
/// 选中父标签时筛选并入其所有后代标签的对象（集合的包含关系）。
///
/// 非破坏性：仅新增 tag_relations 表与索引，旧库平滑升级。环的预防在服务层 add_tag_relation 完成。
pub struct V007TagRelations;

impl Migration for V007TagRelations {
    fn version(&self) -> u32 {
        7
    }

    fn description(&self) -> &str {
        "Add tag relations (DAG, multi-parent hierarchy)"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tag_relations (
                parent_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                child_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (parent_id, child_id)
            );
            CREATE INDEX IF NOT EXISTS idx_tag_relations_child ON tag_relations(child_id);
            "#,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_creates_tag_relations_table() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);",
        )
        .expect("seed tags");

        V007TagRelations.up(&conn).expect("run migration");

        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tag_relations'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);

        // 幂等
        V007TagRelations.up(&conn).expect("idempotent rerun");
    }
}

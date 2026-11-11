use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 文件柜嵌套（F16 方案 C）：`cabinets.parent_id` 指向父柜，NULL 为顶层；单父树。
/// 防环、「关联文件夹柜只能是叶子」与删除父柜时子柜上移一级均由 cabinet_service 保证
/// （不用外键 ON DELETE：SET NULL 会把子柜直接甩到顶层，而不是上移一级）。
///
/// 非破坏性：仅 ADD COLUMN + 索引；旧柜全部为顶层，升级后侧栏与成员完全不变。
pub struct V023CabinetParent;

impl Migration for V023CabinetParent {
    fn version(&self) -> u32 {
        23
    }

    fn description(&self) -> &str {
        "Add parent_id to cabinets (single-parent nesting)"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !has_column(conn, "cabinets", "parent_id") {
            conn.execute_batch("ALTER TABLE cabinets ADD COLUMN parent_id INTEGER;")?;
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_cabinets_parent ON cabinets(parent_id);",
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_parent_id_idempotently_and_keeps_cabinets_top_level() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE cabinets (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT, folder_path TEXT);
             CREATE TABLE cabinet_items (cabinet_id INTEGER, item_id INTEGER, PRIMARY KEY(cabinet_id, item_id));
             INSERT INTO cabinets (name) VALUES ('a'), ('b');
             INSERT INTO cabinet_items VALUES (1, 10), (2, 20);",
        )
        .unwrap();
        V023CabinetParent.up(&conn).unwrap();
        V023CabinetParent.up(&conn).unwrap();
        let (n, parents): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COUNT(parent_id) FROM cabinets",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((n, parents), (2, 0), "旧柜保留且全部为顶层");
        let members: i64 = conn
            .query_row("SELECT COUNT(*) FROM cabinet_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(members, 2, "成员不受影响");
    }
}

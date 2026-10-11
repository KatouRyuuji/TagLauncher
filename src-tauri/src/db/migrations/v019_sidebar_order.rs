use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 标签与文件柜的侧栏手动顺序（升序）。默认 0，相同值按界面默认规则排，
/// 因此升级后顺序不变，首次拖动排序时整列写入。
///
/// 非破坏性：仅 ADD COLUMN。
pub struct V019SidebarOrder;

impl Migration for V019SidebarOrder {
    fn version(&self) -> u32 {
        19
    }

    fn description(&self) -> &str {
        "Add sort_order to tags and cabinets"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        for table in ["tags", "cabinets"] {
            if !has_column(conn, table, "sort_order") {
                conn.execute_batch(&format!(
                    "ALTER TABLE {table} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;"
                ))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_sort_order_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);
             CREATE TABLE cabinets (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);
             INSERT INTO tags (name) VALUES ('t');
             INSERT INTO cabinets (name) VALUES ('c');",
        )
        .unwrap();
        V019SidebarOrder.up(&conn).unwrap();
        V019SidebarOrder.up(&conn).unwrap();
        for table in ["tags", "cabinets"] {
            let order: i64 = conn
                .query_row(&format!("SELECT sort_order FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(order, 0, "{table} 旧行默认 0");
        }
    }
}

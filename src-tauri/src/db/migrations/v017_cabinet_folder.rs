use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 文件柜可关联磁盘文件夹：`folder_path` 非空时柜内成员由路径决定（不读 cabinet_items），
/// `folder_truncated` 记录最近一次同步是否因上限截断。同一文件夹（不区分大小写）只能关联一个柜。
///
/// 非破坏性：仅 ADD COLUMN 与新建部分唯一索引。
pub struct V017CabinetFolder;

impl Migration for V017CabinetFolder {
    fn version(&self) -> u32 {
        17
    }

    fn description(&self) -> &str {
        "Add cabinets.folder_path and folder_truncated with unique folder index"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !has_column(conn, "cabinets", "folder_path") {
            conn.execute_batch("ALTER TABLE cabinets ADD COLUMN folder_path TEXT;")?;
        }
        if !has_column(conn, "cabinets", "folder_truncated") {
            conn.execute_batch(
                "ALTER TABLE cabinets ADD COLUMN folder_truncated INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_cabinets_folder
                 ON cabinets(folder_path COLLATE NOCASE) WHERE folder_path IS NOT NULL;",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_folder_columns_and_unique_index_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE cabinets (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
             INSERT INTO cabinets (name) VALUES ('a'), ('b');",
        )
        .unwrap();
        V017CabinetFolder.up(&conn).unwrap();
        V017CabinetFolder.up(&conn).unwrap();
        assert!(has_column(&conn, "cabinets", "folder_path"));
        let truncated: i64 = conn
            .query_row(
                "SELECT folder_truncated FROM cabinets WHERE name = 'a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(truncated, 0);
        conn.execute(
            "UPDATE cabinets SET folder_path = 'D:\\Media' WHERE name = 'a'",
            [],
        )
        .unwrap();
        let dup = conn.execute(
            "UPDATE cabinets SET folder_path = 'd:\\media' WHERE name = 'b'",
            [],
        );
        assert!(dup.is_err(), "同一文件夹不区分大小写只能关联一个柜");
    }
}

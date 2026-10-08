use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 为对象增加用户备注列（纯文本，空备注存 NULL）。
///
/// 非破坏性：仅 ADD COLUMN，旧库平滑升级。
pub struct V015ItemNote;

impl Migration for V015ItemNote {
    fn version(&self) -> u32 {
        15
    }

    fn description(&self) -> &str {
        "Add note column to items"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        // 幂等：新库 schema 已含该列时跳过。
        if !has_column(conn, "items", "note") {
            conn.execute_batch("ALTER TABLE items ADD COLUMN note TEXT;")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_note_column_idempotently() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL
            );
            INSERT INTO items (name, path) VALUES ('a', 'D:\a.exe');
            "#,
        )
        .expect("seed");

        V015ItemNote.up(&conn).expect("run migration");
        assert!(has_column(&conn, "items", "note"));

        let (n, note): (i64, Option<String>) = conn
            .query_row("SELECT COUNT(*), MAX(note) FROM items", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(n, 1, "数据无损");
        assert_eq!(note, None, "旧对象备注为空");

        V015ItemNote.up(&conn).expect("idempotent rerun");
    }
}

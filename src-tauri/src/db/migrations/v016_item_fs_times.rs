use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 为对象增加文件系统创建 / 修改时间列（Unix 秒，UTC；取不到存 NULL），
/// 与入库时间 `created_at` 区分。由导入写入、对账回填与纠正。
///
/// 非破坏性：仅 ADD COLUMN，旧库平滑升级。
pub struct V016ItemFsTimes;

impl Migration for V016ItemFsTimes {
    fn version(&self) -> u32 {
        16
    }

    fn description(&self) -> &str {
        "Add fs_created_at and fs_modified_at columns to items"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        // 幂等：新库 schema 已含该列时跳过。
        for column in ["fs_created_at", "fs_modified_at"] {
            if !has_column(conn, "items", column) {
                conn.execute_batch(&format!("ALTER TABLE items ADD COLUMN {column} INTEGER;"))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_fs_time_columns_idempotently() {
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

        V016ItemFsTimes.up(&conn).expect("run migration");
        assert!(has_column(&conn, "items", "fs_created_at"));
        assert!(has_column(&conn, "items", "fs_modified_at"));

        let (n, created, modified): (i64, Option<i64>, Option<i64>) = conn
            .query_row("SELECT COUNT(*), MAX(fs_created_at), MAX(fs_modified_at) FROM items", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(n, 1, "数据无损");
        assert_eq!((created, modified), (None, None), "旧对象等待对账回填");

        V016ItemFsTimes.up(&conn).expect("idempotent rerun");
    }
}

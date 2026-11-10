use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 为对象增加「显示别名」（F07）：只影响界面显示与搜索，磁盘文件名与 `name`/`path` 不变。
/// 空别名存 NULL。
///
/// 非破坏性：仅 ADD COLUMN，旧库平滑升级。
pub struct V022ItemAlias;

impl Migration for V022ItemAlias {
    fn version(&self) -> u32 {
        22
    }

    fn description(&self) -> &str {
        "Add display-only alias column to items"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !has_column(conn, "items", "alias") {
            conn.execute_batch("ALTER TABLE items ADD COLUMN alias TEXT;")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_alias_column_idempotently_without_touching_names() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL
            );
            INSERT INTO items (name, path) VALUES ('setup.exe', 'D:\setup.exe');
            "#,
        )
        .expect("seed");

        V022ItemAlias.up(&conn).expect("run migration");
        assert!(has_column(&conn, "items", "alias"));
        let (n, name, alias): (i64, String, Option<String>) = conn
            .query_row(
                "SELECT COUNT(*), MAX(name), MAX(alias) FROM items",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(n, 1, "数据无损");
        assert_eq!(name, "setup.exe", "磁盘名不变");
        assert_eq!(alias, None, "旧对象没有别名");

        V022ItemAlias.up(&conn).expect("idempotent rerun");
    }
}

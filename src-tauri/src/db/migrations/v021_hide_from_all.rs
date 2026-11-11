use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 为对象增加「默认不出现在 All 总览」标记。
/// 仅新导入的递归子内容默认置 1；旧行 DEFAULT 0，既有散文件不会被静默隐藏。
///
/// 非破坏性：仅 ADD COLUMN。关切换或导出/备份都不丢行。
pub struct V021HideFromAll;

impl Migration for V021HideFromAll {
    fn version(&self) -> u32 {
        21
    }

    fn description(&self) -> &str {
        "Add hide_from_all so nested import contents stay in the library without flooding All"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !has_column(conn, "items", "hide_from_all") {
            conn.execute_batch(
                "ALTER TABLE items ADD COLUMN hide_from_all INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_hide_from_all_defaulting_existing_rows_to_visible() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL
            );
            INSERT INTO items (name, path) VALUES ('old', 'D:\old.exe');
            "#,
        )
        .expect("seed");

        V021HideFromAll.up(&conn).expect("run migration");
        assert!(has_column(&conn, "items", "hide_from_all"));

        let (n, hidden): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), MAX(hide_from_all) FROM items",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(n, 1, "数据无损");
        assert_eq!(hidden, 0, "旧对象保持可见，不能静默隐藏");

        V021HideFromAll.up(&conn).expect("idempotent rerun");
        conn.execute(
            "INSERT INTO items (name, path) VALUES ('fresh', 'D:\\fresh.exe')",
            [],
        )
        .unwrap();
        let fresh: i64 = conn
            .query_row(
                "SELECT hide_from_all FROM items WHERE path = 'D:\\fresh.exe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fresh, 0, "未显式指定时新建行仍默认可见");
    }
}

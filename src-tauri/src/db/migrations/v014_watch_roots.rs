use super::Migration;
use rusqlite::Connection;

/// 文件夹监视根：挂在 folder 对象上，默认关；总闸写入 app_meta。
pub struct V014WatchRoots;

impl Migration for V014WatchRoots {
    fn version(&self) -> u32 {
        14
    }

    fn description(&self) -> &str {
        "Add watch_roots and default folder_watch_master"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS watch_roots (
                item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
                enabled INTEGER NOT NULL DEFAULT 1,
                recursive INTEGER NOT NULL DEFAULT 1,
                last_scan_at DATETIME
            );
            INSERT OR IGNORE INTO app_meta (key, value) VALUES ('folder_watch_master', '1');
            "#,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_watch_roots_and_default_master() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY);
             CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
        V014WatchRoots.up(&conn).unwrap();
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='watch_roots'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
        let master: String = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key='folder_watch_master'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(master, "1");
        V014WatchRoots.up(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_meta WHERE key='folder_watch_master'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}

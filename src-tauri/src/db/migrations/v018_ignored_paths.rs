use super::Migration;
use rusqlite::Connection;

/// 不再追踪的路径：监视文件夹或关联文件夹里被「从库中移除」的对象，补扫与变更通知都跳过它（文件夹含其下全部内容）。
/// `path_key` 为反斜杠、小写化的路径，用于不区分大小写的前缀匹配。
///
/// 非破坏性：仅新建表。
pub struct V018IgnoredPaths;

impl Migration for V018IgnoredPaths {
    fn version(&self) -> u32 {
        18
    }

    fn description(&self) -> &str {
        "Add ignored_paths for untracked items under watched folders"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ignored_paths (
                 path_key TEXT PRIMARY KEY,
                 path TEXT NOT NULL,
                 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
             );",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_ignored_paths_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        V018IgnoredPaths.up(&conn).unwrap();
        V018IgnoredPaths.up(&conn).unwrap();
        conn.execute(
            "INSERT INTO ignored_paths (path_key, path) VALUES ('d:\\a', 'D:\\a')",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ignored_paths", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}

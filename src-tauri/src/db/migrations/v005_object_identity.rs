use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 对象身份重构：把唯一标识从"绝对路径"改为"NTFS 卷序列号 + 文件ID"。
/// - 去掉 items.path 的 UNIQUE（path 降级为可更新的"最近已知位置"）
/// - 新增 volume_serial / file_id / is_missing 列
/// - 新增按 (volume_serial, file_id) 的部分唯一索引
///
/// 不在迁移内回填文件ID（避免大库启动卡顿），由首次刷新时的 reconcile 惰性回填。
pub struct V005ObjectIdentity;

impl Migration for V005ObjectIdentity {
    fn version(&self) -> u32 {
        5
    }

    fn description(&self) -> &str {
        "Object identity by NTFS file id"
    }

    fn is_breaking(&self) -> bool {
        true
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        // 幂等：已含 file_id 列说明本迁移（或新库 schema）已生效，跳过重建
        if has_column(conn, "items", "file_id") {
            return Ok(());
        }
        rebuild_items_with_identity(conn)
    }
}

// 表重建在 run_pending 提供的事务内执行、外键强制已由框架在事务外关闭，
// 故此处不再自开 BEGIN / 设置 foreign_keys PRAGMA（事务内 PRAGMA 为 no-op）。
fn rebuild_items_with_identity(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS items_ai;
        DROP TRIGGER IF EXISTS items_ad;
        DROP TRIGGER IF EXISTS items_au;

        CREATE TABLE items_new (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT CHECK(type IN ('folder', 'image', 'audio', 'exe', 'bat', 'ps1')),
            icon_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            is_favorite INTEGER DEFAULT 0,
            volume_serial INTEGER,
            file_id TEXT,
            is_missing INTEGER NOT NULL DEFAULT 0
        );

        INSERT INTO items_new (id, name, path, type, icon_path, created_at, last_used_at, is_favorite)
        SELECT id, name, path, type, icon_path, created_at, last_used_at, COALESCE(is_favorite, 0)
        FROM items;

        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_identity
            ON items(volume_serial, file_id) WHERE file_id IS NOT NULL;

        DROP TABLE IF EXISTS items_fts;
        CREATE VIRTUAL TABLE items_fts USING fts5(
            name, path, content=items, content_rowid=id
        );
        INSERT INTO items_fts(rowid, name, path) SELECT id, name, path FROM items;

        CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
            INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
        END;
        CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
        END;
        CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
            INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
        END;
        "#,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_identity_columns_and_drops_path_unique() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                type TEXT CHECK(type IN ('folder', 'image', 'audio', 'exe', 'bat', 'ps1')),
                icon_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME,
                is_favorite INTEGER DEFAULT 0
            );
            CREATE VIRTUAL TABLE items_fts USING fts5(name, path, content=items, content_rowid=id);
            INSERT INTO items (name, path, type) VALUES ('a', 'D:\dir\a.exe', 'exe');
            INSERT INTO items (name, path, type) VALUES ('b', 'D:\dir\b.exe', 'exe');
            "#,
        )
        .expect("create old schema");

        V005ObjectIdentity.up(&conn).expect("run migration");

        // 新列存在
        assert!(has_column(&conn, "items", "volume_serial"));
        assert!(has_column(&conn, "items", "file_id"));
        assert!(has_column(&conn, "items", "is_missing"));

        // 数据无损
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 2);

        // path 不再唯一：可插入两条相同 path（身份不同/为空时允许）
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES ('c', 'D:\\dir\\a.exe', 'exe')",
            [],
        )
        .expect("duplicate path now allowed");

        // 身份唯一索引存在
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_items_identity'",
                [],
                |r| r.get(0),
            )
            .expect("query index");
        assert_eq!(idx, 1);

        // 再次执行幂等（已含 file_id 列则跳过）
        V005ObjectIdentity.up(&conn).expect("idempotent rerun");
    }
}

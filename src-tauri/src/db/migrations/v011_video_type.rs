use super::Migration;
use rusqlite::Connection;

/// 为对象表增加 video 类型，并把已有视频路径重新归类。
/// 表重建结构对齐 v005 之后的完整列（含身份列与签名列）。
pub struct V011VideoType;

impl Migration for V011VideoType {
    fn version(&self) -> u32 {
        11
    }

    fn description(&self) -> &str {
        "Add video item type"
    }

    // 可能重建 items 表（旧库 type 约束缺 'video'），统一标为破坏性：
    // 由 run_pending 在事务外做备份并关闭外键强制。
    fn is_breaking(&self) -> bool {
        true
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !items_table_supports_video_type(conn) {
            migrate_items_table_with_video_type(conn)?;
        }

        // 仅按路径扩展名重分类，但排除目录：名为 "xxx.mp4" 的文件夹不应被改判为 video。
        // `IS NOT 'folder'`（而非 `<> 'folder'`）让历史 NULL type 行仍按旧行为被重分类。
        // 扩展名清单直接取 item_service::VIDEO_EXTS，避免两处漂移。
        conn.execute_batch(&video_reclassify_sql())?;

        Ok(())
    }
}

fn video_reclassify_sql() -> String {
    let preds = crate::services::item_service::VIDEO_EXTS
        .iter()
        .map(|ext| format!("lower(path) GLOB '*.{ext}'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!(
        "UPDATE items SET type = 'video' WHERE type IS NOT 'folder' AND ({preds});"
    )
}

fn items_table_supports_video_type(conn: &Connection) -> bool {
    let sql = conn
        .query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type = 'table' AND name = 'items'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();
    sql.to_lowercase().contains("'video'")
}

// 表重建在 run_pending 提供的事务内执行、外键强制已由框架在事务外关闭，
// 故此处不再自开 BEGIN / 设置 foreign_keys PRAGMA（事务内 PRAGMA 为 no-op）。
fn migrate_items_table_with_video_type(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS items_ai;
        DROP TRIGGER IF EXISTS items_ad;
        DROP TRIGGER IF EXISTS items_au;

        CREATE TABLE items_new (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT CHECK(type IN ('folder', 'image', 'audio', 'video', 'exe', 'bat', 'ps1')),
            icon_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            is_favorite INTEGER DEFAULT 0,
            volume_serial INTEGER,
            file_id TEXT,
            is_missing INTEGER NOT NULL DEFAULT 0,
            sig_size INTEGER,
            sig_head INTEGER,
            sig_tail INTEGER
        );

        INSERT INTO items_new (id, name, path, type, icon_path, created_at, last_used_at, is_favorite,
                               volume_serial, file_id, is_missing, sig_size, sig_head, sig_tail)
        SELECT id, name, path, type, icon_path, created_at, last_used_at, COALESCE(is_favorite, 0),
               volume_serial, file_id, COALESCE(is_missing, 0), sig_size, sig_head, sig_tail
        FROM items;

        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_identity
            ON items(volume_serial, file_id) WHERE file_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_items_path ON items(path);

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

        CREATE INDEX IF NOT EXISTS idx_item_tags_tag_item
            ON item_tags(tag_id, item_id);

        CREATE INDEX IF NOT EXISTS idx_item_tags_item_position
            ON item_tags(item_id, position);

        CREATE INDEX IF NOT EXISTS idx_cabinet_items_item
            ON cabinet_items(item_id);
        "#,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_reclassifies_video_and_preserves_identity_columns() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
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
                is_missing INTEGER NOT NULL DEFAULT 0,
                sig_size INTEGER,
                sig_head INTEGER,
                sig_tail INTEGER
            );
            CREATE TABLE item_tags (
                item_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE cabinet_items (
                cabinet_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL
            );
            INSERT INTO items (name, path, type, volume_serial, file_id, sig_size)
            VALUES ('clip', 'D:\Video\clip.mp4', 'exe', 123, 'abc', 42);
            INSERT INTO items (name, path, type)
            VALUES ('mp4dir', 'D:\Video\backup.mp4', 'folder');
            INSERT INTO items (name, path, type) VALUES ('track', 'D:\Music\t.mp3', 'audio');
            "#,
        )
        .expect("create old schema");

        V011VideoType.up(&conn).expect("run migration");

        let clip: (String, Option<i64>, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT type, volume_serial, file_id, sig_size FROM items WHERE name = 'clip'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("read migrated item");
        assert_eq!(clip.0, "video");
        assert_eq!(clip.1, Some(123), "身份列应保留");
        assert_eq!(clip.2.as_deref(), Some("abc"));
        assert_eq!(clip.3, Some(42), "签名列应保留");

        // 名为 *.mp4 的文件夹不应被视频重分类改判
        let dir_type: String = conn
            .query_row("SELECT type FROM items WHERE name = 'mp4dir'", [], |r| r.get(0))
            .expect("read migrated folder type");
        assert_eq!(dir_type, "folder", "文件夹不应被改判为 video");

        // 音频不受影响
        let audio_type: String = conn
            .query_row("SELECT type FROM items WHERE name = 'track'", [], |r| r.get(0))
            .expect("read audio type");
        assert_eq!(audio_type, "audio");

        // 身份唯一索引与 path 索引重建
        for index_name in ["idx_items_identity", "idx_items_path"] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    [index_name],
                    |r| r.get(0),
                )
                .expect("query index");
            assert_eq!(exists, 1, "missing index {index_name}");
        }

        // 新约束允许直接写入 video
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES ('v2', 'D:\\Video\\b.mkv', 'video')",
            [],
        )
        .expect("video type accepted by CHECK");

        // 幂等：再次执行（约束已含 video，跳过重建，仅重分类）
        V011VideoType.up(&conn).expect("idempotent rerun");
    }

    #[test]
    fn reclassify_sql_covers_item_service_video_exts() {
        let sql = video_reclassify_sql();
        for ext in crate::services::item_service::VIDEO_EXTS {
            assert!(sql.contains(&format!("*.{ext}")), "missing glob for .{ext}");
        }
    }
}

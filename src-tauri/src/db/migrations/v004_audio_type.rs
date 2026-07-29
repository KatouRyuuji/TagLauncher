use super::Migration;
use rusqlite::Connection;

/// 为对象表增加 audio 类型，并把已有音频路径重新归类。
pub struct V004AudioType;

impl Migration for V004AudioType {
    fn version(&self) -> u32 {
        4
    }

    fn description(&self) -> &str {
        "Add audio item type"
    }

    // 可能重建 items 表（旧库 type 约束缺 'audio'），统一标为破坏性：
    // 由 run_pending 在事务外做备份并关闭外键强制。
    fn is_breaking(&self) -> bool {
        true
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        if !items_table_supports_audio_type(conn) {
            migrate_items_table_with_audio_type(conn)?;
        }

        conn.execute_batch(
            r#"
            UPDATE items
            SET type = 'audio'
            WHERE lower(path) GLOB '*.aac'
               OR lower(path) GLOB '*.ape'
               OR lower(path) GLOB '*.aiff'
               OR lower(path) GLOB '*.aif'
               OR lower(path) GLOB '*.afc'
               OR lower(path) GLOB '*.aifc'
               OR lower(path) GLOB '*.mp3'
               OR lower(path) GLOB '*.mp2'
               OR lower(path) GLOB '*.mp1'
               OR lower(path) GLOB '*.wav'
               OR lower(path) GLOB '*.wave'
               OR lower(path) GLOB '*.wv'
               OR lower(path) GLOB '*.opus'
               OR lower(path) GLOB '*.flac'
               OR lower(path) GLOB '*.ogg'
               OR lower(path) GLOB '*.m4a'
               OR lower(path) GLOB '*.m4b'
               OR lower(path) GLOB '*.m4p'
               OR lower(path) GLOB '*.m4r'
               OR lower(path) GLOB '*.mpc'
               OR lower(path) GLOB '*.mp+'
               OR lower(path) GLOB '*.mpp'
               OR lower(path) GLOB '*.spx';
            "#,
        )?;

        Ok(())
    }
}

fn items_table_supports_audio_type(conn: &Connection) -> bool {
    let sql = conn
        .query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type = 'table' AND name = 'items'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();
    sql.to_lowercase().contains("'audio'")
}

// 表重建在 run_pending 提供的事务内执行、外键强制已由框架在事务外关闭，
// 故此处不再自开 BEGIN / 设置 foreign_keys PRAGMA（事务内 PRAGMA 为 no-op）。
fn migrate_items_table_with_audio_type(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS items_ai;
        DROP TRIGGER IF EXISTS items_ad;
        DROP TRIGGER IF EXISTS items_au;

        CREATE TABLE items_new (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT UNIQUE NOT NULL,
            type TEXT CHECK(type IN ('folder', 'image', 'audio', 'exe', 'bat', 'ps1')),
            icon_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            is_favorite INTEGER DEFAULT 0
        );

        INSERT INTO items_new (id, name, path, type, icon_path, created_at, last_used_at, is_favorite)
        SELECT id, name, path, type, icon_path, created_at, last_used_at, COALESCE(is_favorite, 0)
        FROM items;

        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;

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
    fn migration_preserves_existing_indexes_after_rebuilding_items() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                type TEXT CHECK(type IN ('folder', 'image', 'exe', 'bat', 'ps1')),
                icon_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME,
                is_favorite INTEGER DEFAULT 0
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
            CREATE INDEX idx_item_tags_tag_item ON item_tags(tag_id, item_id);
            CREATE INDEX idx_item_tags_item_position ON item_tags(item_id, position);
            CREATE INDEX idx_cabinet_items_item ON cabinet_items(item_id);
            INSERT INTO items (name, path, type) VALUES ('track', 'D:\Music\track.mp3', 'exe');
            "#,
        )
        .expect("create old schema");

        V004AudioType.up(&conn).expect("run migration");

        let item_type: String = conn
            .query_row("SELECT type FROM items WHERE name = 'track'", [], |r| r.get(0))
            .expect("read migrated item type");
        assert_eq!(item_type, "audio");

        for index_name in [
            "idx_item_tags_tag_item",
            "idx_item_tags_item_position",
            "idx_cabinet_items_item",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    [index_name],
                    |r| r.get(0),
                )
                .expect("query index");
            assert_eq!(exists, 1, "missing index {index_name}");
        }
    }
}

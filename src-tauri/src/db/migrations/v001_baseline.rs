use super::Migration;
use rusqlite::Connection;

/// 基线迁移：确保从旧版本升级的数据库兼容新 schema
///
/// 旧版本可能缺少 icon_path、is_favorite 列，type 约束可能不含 'image'。
/// 此迁移幂等执行：检查后再操作。
pub struct V001Baseline;

impl Migration for V001Baseline {
    fn version(&self) -> u32 {
        1
    }
    fn description(&self) -> &str {
        "Baseline: ensure icon_path, is_favorite, image type"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        // 1. 确保 icon_path 列存在
        if !has_column(conn, "items", "icon_path") {
            conn.execute_batch("ALTER TABLE items ADD COLUMN icon_path TEXT")?;
        }

        // 2. 确保 is_favorite 列存在
        if !has_column(conn, "items", "is_favorite") {
            conn.execute_batch("ALTER TABLE items ADD COLUMN is_favorite INTEGER DEFAULT 0")?;
        }

        // 3. 确保 type 约束包含 'image'
        if !items_table_supports_image_type(conn) {
            migrate_items_table_with_image_type(conn)?;
        }

        Ok(())
    }
}

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'",
        table, column
    ))
    .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
    .unwrap_or(0)
        > 0
}

fn items_table_supports_image_type(conn: &Connection) -> bool {
    let sql = conn
        .query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type = 'table' AND name = 'items'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();
    sql.to_lowercase().contains("'image'")
}

fn migrate_items_table_with_image_type(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;

        DROP TRIGGER IF EXISTS items_ai;
        DROP TRIGGER IF EXISTS items_ad;
        DROP TRIGGER IF EXISTS items_au;

        CREATE TABLE items_new (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT UNIQUE NOT NULL,
            type TEXT CHECK(type IN ('folder', 'image', 'exe', 'bat', 'ps1')),
            icon_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            is_favorite INTEGER DEFAULT 0
        );

        INSERT INTO items_new (id, name, path, type, icon_path, created_at, last_used_at, is_favorite)
        SELECT
            id, name, path,
            CASE
                WHEN lower(path) GLOB '*.png' OR lower(path) GLOB '*.jpg'
                  OR lower(path) GLOB '*.jpeg' OR lower(path) GLOB '*.webp'
                  OR lower(path) GLOB '*.bmp' OR lower(path) GLOB '*.gif'
                  OR lower(path) GLOB '*.ico' OR lower(path) GLOB '*.svg'
                  OR lower(path) GLOB '*.tif' OR lower(path) GLOB '*.tiff'
                  OR lower(path) GLOB '*.avif' OR lower(path) GLOB '*.heic'
                  OR lower(path) GLOB '*.heif'
                THEN 'image'
                ELSE type
            END,
            icon_path, created_at, last_used_at, COALESCE(is_favorite, 0)
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

        COMMIT;
        PRAGMA foreign_keys = ON;
        "#,
    )
}

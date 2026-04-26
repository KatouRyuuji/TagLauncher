use rusqlite::Connection;

/// 创建所有基础表（幂等）
pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        -- ========== 项目表 ==========
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT UNIQUE NOT NULL,
            type TEXT CHECK(type IN ('folder', 'image', 'exe', 'bat', 'ps1')),
            icon_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            is_favorite INTEGER DEFAULT 0
        );

        -- ========== 标签表 ==========
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#3b82f6'
        );

        -- ========== 项目-标签关联表 ==========
        CREATE TABLE IF NOT EXISTS item_tags (
            item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (item_id, tag_id)
        );

        CREATE INDEX IF NOT EXISTS idx_item_tags_tag_item
            ON item_tags(tag_id, item_id);

        CREATE INDEX IF NOT EXISTS idx_item_tags_item_position
            ON item_tags(item_id, position);

        -- ========== FTS5 全文搜索虚拟表 ==========
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
            name, path, content=items, content_rowid=id
        );

        -- ========== FTS5 自动同步触发器 ==========
        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
            INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
        END;

        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
        END;

        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
            INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
        END;

        -- ========== 文件柜表 ==========
        CREATE TABLE IF NOT EXISTS cabinets (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#6366f1',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- ========== 文件柜-项目关联表 ==========
        CREATE TABLE IF NOT EXISTS cabinet_items (
            cabinet_id INTEGER REFERENCES cabinets(id) ON DELETE CASCADE,
            item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
            PRIMARY KEY (cabinet_id, item_id)
        );

        CREATE INDEX IF NOT EXISTS idx_cabinet_items_item
            ON cabinet_items(item_id);

        -- ========== 应用元数据表 ==========
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- ========== Mod 专属数据表 ==========
        CREATE TABLE IF NOT EXISTS mod_kv (
            mod_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (mod_id, key)
        );

        CREATE TABLE IF NOT EXISTS mod_records (
            mod_id TEXT NOT NULL,
            collection TEXT NOT NULL,
            id TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (mod_id, collection, id)
        );

        CREATE INDEX IF NOT EXISTS idx_mod_records_collection
            ON mod_records(mod_id, collection);
        "#,
    )
}

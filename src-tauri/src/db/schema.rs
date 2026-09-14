use crate::db::has_column;
use rusqlite::Connection;

pub(crate) const FTS_UPDATE_TRIGGER: &str = r#"
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE OF id, name, path ON items
WHEN old.id IS NOT new.id OR old.name IS NOT new.name OR old.path IS NOT new.path
BEGIN
    INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
    INSERT INTO items_fts(rowid, name, path) VALUES(new.id, new.name, new.path);
END;
"#;

/// 创建所有基础表（幂等）
pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        -- ========== 项目表 ==========
        -- 对象身份以 (volume_serial, file_id) 为准（NTFS 文件ID，跨重命名/同盘移动稳定）；
        -- path 为"最近已知位置"，可更新、不再唯一；取不到文件ID的对象回退按 path 去重。
        CREATE TABLE IF NOT EXISTS items (
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

        -- 注意: idx_items_identity（身份唯一索引）不能放在此批处理中,
        -- 因为升级中的老库此时尚无 volume_serial/file_id 列(由 v005 迁移补齐),
        -- 否则 CREATE INDEX 会因列不存在而报错。改为批处理后按列存在与否条件创建。

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

        -- ========== 标签层级关系（DAG，多继承） ==========
        CREATE TABLE IF NOT EXISTS tag_relations (
            parent_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            child_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (parent_id, child_id)
        );

        CREATE INDEX IF NOT EXISTS idx_tag_relations_child
            ON tag_relations(child_id);

        -- 注意: idx_item_tags_item_position 由 V003PerformanceIndexes 迁移创建,
        -- 不能放在此处, 否则会在 position 列尚未补齐时(老库)报错

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
    )?;
    conn.execute_batch(FTS_UPDATE_TRIGGER)?;

    // 身份唯一索引：仅当 items 已具备 file_id 列时创建（新库由上面的 CREATE TABLE 建出该列；
    // 升级中的老库此时还没有该列，需等 v005 迁移补齐后由迁移内创建，故此处先跳过）。
    // path 全索引覆盖所有对象；仅在检测到部分索引时重建。
    if has_column(conn, "items", "file_id") {
        let partial: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_index_list('items') WHERE name='idx_items_path' AND partial=1)",
            [], |row| row.get(0),
        )?;
        if partial { conn.execute_batch("DROP INDEX idx_items_path;")?; }
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_items_identity \
             ON items(volume_serial, file_id) WHERE file_id IS NOT NULL; \
             CREATE INDEX IF NOT EXISTS idx_items_path ON items(path);",
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use rusqlite::Connection;

    #[test]
    fn initialization_preserves_valid_path_index_and_repairs_partial_index() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        let schema_version = || conn.query_row("PRAGMA schema_version", [], |row| row.get::<_, i64>(0)).unwrap();
        let version = schema_version();
        create_tables(&conn).unwrap();
        assert_eq!(schema_version(), version, "正常重复初始化保持 schema 不变");
        conn.execute_batch("DROP INDEX idx_items_path; CREATE INDEX idx_items_path ON items(path) WHERE file_id IS NULL;").unwrap();
        create_tables(&conn).unwrap();
        let partial: bool = conn.query_row("SELECT partial FROM pragma_index_list('items') WHERE name='idx_items_path'", [], |row| row.get(0)).unwrap();
        assert!(!partial);
        let version = schema_version();
        create_tables(&conn).unwrap();
        assert_eq!(schema_version(), version);
    }

    /// 全新库初始化路径：create_tables（新结构）+ run_pending，最终应具备身份列与索引、path 不唯一。
    #[test]
    fn fresh_init_has_identity_columns_and_no_path_unique() {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        create_tables(&conn).expect("create_tables");
        migrations::run_pending(&conn).expect("run_pending");

        assert!(has_column(&conn, "items", "volume_serial"));
        assert!(has_column(&conn, "items", "file_id"));
        assert!(has_column(&conn, "items", "is_missing"));

        // path 不再唯一：可插两条同 path
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES ('a','D:\\x.exe','exe')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES ('b','D:\\x.exe','exe')",
            [],
        )
        .expect("path 不应有唯一约束");

        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_items_identity'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "身份唯一索引应存在");

        // path 全索引应存在（按 path 去重的查询避免全表扫描；历史上误建过
        // `WHERE file_id IS NULL` 部分索引，已被 schema 初始化自愈为全索引）。
        let path_idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_items_path'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(path_idx, 1, "path 全索引应存在");
    }

    /// 升级库路径：模拟 v4 老库（path UNIQUE、无身份列、schema_version=4），
    /// 再走真实初始化序列 create_tables + run_pending，不应在建索引时因缺列而报错，
    /// 且升级后应补齐身份列与索引。
    #[test]
    fn upgrade_from_v4_does_not_crash_on_identity_index() {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                type TEXT CHECK(type IN ('folder','image','audio','exe','bat','ps1')),
                icon_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME,
                is_favorite INTEGER DEFAULT 0
            );
            CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);
            CREATE TABLE item_tags (item_id INTEGER, tag_id INTEGER, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(item_id, tag_id));
            CREATE TABLE cabinets (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT, created_at DATETIME);
            CREATE TABLE cabinet_items (cabinet_id INTEGER, item_id INTEGER, PRIMARY KEY(cabinet_id, item_id));
            CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE VIRTUAL TABLE items_fts USING fts5(name, path, content=items, content_rowid=id);
            INSERT INTO app_meta (key, value) VALUES ('schema_version', '4');
            INSERT INTO items (name, path, type) VALUES ('old','D:\old.exe','exe');
            "#,
        )
        .expect("seed v4 db");

        // 真实初始化序列：先 create_tables（此处不能因缺列建索引而报错），再 run_pending
        create_tables(&conn).expect("create_tables 不应在老库上报错");
        migrations::run_pending(&conn).expect("run_pending 升级");

        assert!(has_column(&conn, "items", "file_id"), "升级后应补齐 file_id");
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_items_identity'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "升级后身份索引应存在");

        // 数据无损
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}

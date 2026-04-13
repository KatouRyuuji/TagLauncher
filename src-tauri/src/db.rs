// ============================================================================
// db.rs — 数据库初始化与连接管理
// ============================================================================
// 负责 SQLite 数据库的创建、建表、迁移和连接池管理。
// 使用 Mutex 包裹 Connection，保证 Tauri 多线程命令调用时的线程安全。
// ============================================================================

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// 数据库管理结构体
/// 通过 `app.manage(database)` 注入 Tauri 状态，命令函数通过 `State<Database>` 获取
pub struct Database {
    /// 使用 Mutex 保护 SQLite 连接，确保同一时刻只有一个线程访问
    conn: Mutex<Connection>,
}

impl Database {
    /// 创建数据库实例并初始化表结构
    ///
    /// # 参数
    /// - `path`: 数据库文件路径（如 `%APPDATA%/com.taglauncher.app/taglauncher.db`）
    ///
    /// # 流程
    /// 1. 打开（或创建）SQLite 文件
    /// 2. 调用 init() 建表和迁移
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    /// 初始化数据库表结构
    ///
    /// 使用 `CREATE TABLE IF NOT EXISTS` 保证幂等性（重复执行不报错）。
    /// 包含以下表：
    /// - items: 项目表（文件/文件夹）
    /// - tags: 标签表
    /// - item_tags: 项目-标签多对多关联表
    /// - items_fts: FTS5 全文搜索虚拟表（自动索引 name 和 path）
    /// - cabinets: 文件柜表
    /// - cabinet_items: 文件柜-项目关联表
    fn init(&self) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            -- ========== 项目表 ==========
            -- 存储用户添加的文件夹、图片和可执行文件
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,                                    -- 文件/文件夹名
                path TEXT UNIQUE NOT NULL,                             -- 完整路径（唯一约束防重复添加）
                type TEXT CHECK(type IN ('folder', 'image', 'exe', 'bat', 'ps1')), -- 类型枚举
                icon_path TEXT,                                        -- 自定义图标路径（预留）
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,         -- 添加时间
                last_used_at DATETIME                                  -- 最后启动时间
            );

            -- ========== 标签表 ==========
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,           -- 标签名（唯一）
                color TEXT DEFAULT '#3b82f6'          -- 颜色 hex 值
            );

            -- ========== 项目-标签关联表 ==========
            -- 多对多关系：一个项目可有多个标签，一个标签可关联多个项目
            -- ON DELETE CASCADE: 删除项目或标签时自动清理关联记录
            CREATE TABLE IF NOT EXISTS item_tags (
                item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (item_id, tag_id)
            );

            -- ========== FTS5 全文搜索虚拟表 ==========
            -- content=items 表示这是 items 表的外部内容表
            -- content_rowid=id 指定使用 items.id 作为行标识
            CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
                name, path, content=items, content_rowid=id
            );

            -- ========== FTS5 自动同步触发器 ==========
            -- 插入项目时，自动将 name/path 添加到搜索索引
            CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
                INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
            END;

            -- 删除项目时，自动从搜索索引中移除
            -- 注意：FTS5 的删除语法是插入特殊的 'delete' 命令
            CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
                INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
            END;

            -- 更新项目时，先删除旧索引再插入新索引
            CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
                INSERT INTO items_fts(items_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
                INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
            END;

            -- ========== 文件柜表 ==========
            -- 文件柜是独立于标签的另一种分类方式
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
            "#,
        )?;

        // ========== 数据库迁移：动态添加 is_favorite 列 ==========
        // 兼容旧版本数据库：检查 icon_path 列是否存在，不存在则添加
        let has_icon_path: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('items') WHERE name='icon_path'")
            .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
            .unwrap_or(0)
            > 0;
        if !has_icon_path {
            conn.execute_batch("ALTER TABLE items ADD COLUMN icon_path TEXT")?;
        }

        // ========== 数据库迁移：动态添加 is_favorite 列 ==========
        // 兼容旧版本数据库：检查 is_favorite 列是否存在，不存在则添加
        // 使用 pragma_table_info 查询表结构，避免 ALTER TABLE 报 "duplicate column" 错误
        let has_favorite: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('items') WHERE name='is_favorite'")
            .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
            .unwrap_or(0)
            > 0;
        if !has_favorite {
            conn.execute_batch("ALTER TABLE items ADD COLUMN is_favorite INTEGER DEFAULT 0")?;
        }

        // ========== 数据库迁移：扩展 items.type 约束支持 image ==========
        // SQLite 无法直接修改 CHECK 约束，因此通过“建新表→迁移数据→替换旧表”完成升级。
        if !items_table_supports_image_type(&conn) {
            migrate_items_table_with_image_type(&conn)?;
        }

        Ok(())
    }

    /// 获取数据库连接（自动加锁）
    ///
    /// 返回 MutexGuard，离开作用域时自动释放锁。
    /// 所有命令函数通过此方法获取连接。
    pub fn get_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}

/// 检查 items 表的 type 约束是否已支持 image
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

/// 迁移 items 表约束，新增 image 类型支持，并重建 FTS 索引和触发器
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
            id,
            name,
            path,
            CASE
                WHEN lower(path) GLOB '*.png'
                  OR lower(path) GLOB '*.jpg'
                  OR lower(path) GLOB '*.jpeg'
                  OR lower(path) GLOB '*.webp'
                  OR lower(path) GLOB '*.bmp'
                  OR lower(path) GLOB '*.gif'
                  OR lower(path) GLOB '*.ico'
                  OR lower(path) GLOB '*.svg'
                  OR lower(path) GLOB '*.tif'
                  OR lower(path) GLOB '*.tiff'
                  OR lower(path) GLOB '*.avif'
                  OR lower(path) GLOB '*.heic'
                  OR lower(path) GLOB '*.heif'
                THEN 'image'
                ELSE type
            END,
            icon_path,
            created_at,
            last_used_at,
            COALESCE(is_favorite, 0)
        FROM items;

        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;

        DROP TABLE IF EXISTS items_fts;
        CREATE VIRTUAL TABLE items_fts USING fts5(
            name, path, content=items, content_rowid=id
        );
        INSERT INTO items_fts(rowid, name, path)
        SELECT id, name, path FROM items;

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
    )?;

    Ok(())
}

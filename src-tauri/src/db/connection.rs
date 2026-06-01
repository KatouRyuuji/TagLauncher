use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

use super::migrations;
use super::schema;

/// 数据库管理结构体
/// 通过 `app.manage(database)` 注入 Tauri 状态，命令函数通过 `State<Database>` 获取
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// 创建数据库实例并初始化表结构
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // WAL + synchronous=NORMAL：显著减少写操作 fsync 次数（批量导入/对账写回/收藏切换更快），
        // 查询结果不变。断电时持久性弱于默认 FULL（可能丢最后若干已提交事务、不损坏库），迭代期可接受。
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;
        schema::create_tables(&conn)?;
        migrations::run_pending(&conn)?;
        Ok(())
    }

    /// 获取数据库连接（自动加锁）
    pub fn get_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

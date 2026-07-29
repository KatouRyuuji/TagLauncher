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
        // temp_store=MEMORY / 更大页缓存 / mmap：提升排序与读多路径的查询性能，均为安全的读侧优化。
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -16384;
             PRAGMA mmap_size = 268435456;",
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实文件库初始化路径（内存库不覆盖 WAL）：
    /// 验证 Database::new 在磁盘文件上启用 WAL、跑完 v001..v005 迁移、身份列就位、可读写。
    #[test]
    fn database_new_initializes_real_file_db() {
        let mut path = std::env::temp_dir();
        path.push(format!("tl_dbinit_{}.db", std::process::id()));
        let p = path.to_string_lossy().to_string();
        // 预清理（含 WAL 旁文件与破坏性迁移备份）
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm"), format!("{p}.pre-v5.bak")] {
            let _ = std::fs::remove_file(&f);
        }

        {
            let db = Database::new(&path).expect("init real file db");
            let conn = db.get_conn();
            // WAL 在文件库上已启用
            let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
            // 迁移执行到最新版本
            let ver: String = conn
                .query_row("SELECT value FROM app_meta WHERE key='schema_version'", [], |r| r.get(0))
                .unwrap();
            assert_eq!(ver, "7");
            // 身份列就位
            let cols: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('items') WHERE name IN ('file_id','is_missing','volume_serial')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(cols, 3);
            // 基本读写可用
            conn.execute("INSERT INTO items (name, path, type) VALUES ('t', 'D:\\t.exe', 'exe')", [])
                .unwrap();
            let cnt: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
            assert_eq!(cnt, 1);
        }

        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm"), format!("{p}.pre-v5.bak")] {
            let _ = std::fs::remove_file(&f);
        }
    }
}

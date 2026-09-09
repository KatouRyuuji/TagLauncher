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
        let conn = open_or_recover(path)?;
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

    /// 冻结写入：置全局冻结标志（各写入口据此返回友好报错），并把实库连接切为
    /// query_only 作为 SQLite 层硬兜底——未接检查点的写路径（如 Mod KV / 启动时间更新）
    /// 同样会被拒绝；读与临时表排序不受影响。
    pub fn freeze_writes(&self) {
        super::freeze_writes();
        let conn = self.get_conn();
        let _ = conn.execute_batch("PRAGMA query_only = ON");
    }

    /// 获取数据库连接（自动加锁）
    pub fn get_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// 打开实库；打开失败或 quick_check 不过时，先用 Backups/ 内最新安全备份做文件级
/// 自愈恢复再打开。导入/云端恢复的实库覆盖只走 SQLite 逻辑层（Backup API），进程崩溃
/// /断电可能留下打不开的实库——逻辑回滚救不了这种情况，自愈是最后防线。
fn open_or_recover(path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Ok(conn) = Connection::open(path) {
        // quick_check 通过时恰返回单行 "ok"；损坏库报错或返回问题描述行
        let healthy = conn
            .query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
            .map(|first| first == "ok")
            .unwrap_or(false);
        if healthy {
            return Ok(conn);
        }
        // 先释放句柄，Windows 下才能改名/覆盖损坏文件
        drop(conn);
    }
    recover_from_safety_backup(path);
    Connection::open(path)
}

/// 备份目录名（与 data_commands::BACKUPS_DIR_NAME 保持一致）。
const BACKUPS_DIR_NAME: &str = "Backups";

/// 用 Backups/ 里最新的导入/恢复前安全备份文件级覆盖实库。
/// 损坏原文件改名留存为 .corrupt-<epoch> 供人工排查；无可用备份时保持原状，
/// 让后续打开按原样报错（行为与不自愈一致）。
fn recover_from_safety_backup(path: &Path) {
    let Some(dir) = path.parent() else { return };
    let backups_dir = dir.join(BACKUPS_DIR_NAME);
    // 备份文件名含 UTC 时间戳，字典序最大即最新
    let latest = std::fs::read_dir(&backups_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| {
                    (n.starts_with("taglauncher_pre_import_")
                        || n.starts_with("taglauncher_pre_restore_"))
                        && n.ends_with(".db")
                })
                .unwrap_or(false)
        })
        .max();
    let Some(backup) = latest else {
        eprintln!("[db] 实库 {:?} 打开/完整性校验失败，且无安全备份可自愈", path);
        return;
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let corrupt = path.with_file_name(format!(
        "{}.corrupt-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("taglauncher.db"),
        ts
    ));
    // 先 rename 主文件（成功后才动 WAL/SHM）：rename 失败说明文件被占用，
    // 此时保留 WAL 现场不做任何破坏；改名成功后 WAL/SHM 属损坏状态，
    // 一并改名留存（而非删除），既防恢复后被错误回放，也保住现场供人工排查。
    let path_str = path.to_string_lossy().to_string();
    if let Err(e) = std::fs::rename(path, &corrupt) {
        eprintln!("[db] 损坏实库改名留存失败({})，放弃自愈", e);
        return;
    }
    let corrupt_str = corrupt.to_string_lossy().to_string();
    for suffix in ["-wal", "-shm"] {
        let side = format!("{}{}", path_str, suffix);
        if std::path::Path::new(&side).exists() {
            // 改名失败（占用/权限）时退而删除：stale WAL 绝不能在恢复的备份上被回放
            if std::fs::rename(&side, format!("{}{}", corrupt_str, suffix)).is_err() {
                let _ = std::fs::remove_file(&side);
            }
        }
    }
    match std::fs::copy(&backup, path) {
        Ok(_) => eprintln!(
            "[db] 实库损坏，已用安全备份 {:?} 自愈恢复；损坏文件留存为 {:?}",
            backup, corrupt
        ),
        Err(e) => {
            eprintln!("[db] 从安全备份 {:?} 恢复失败: {}", backup, e);
            // 尽力把损坏文件放回原位，保持故障现场可人工处理
            let _ = std::fs::rename(&corrupt, path);
        }
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
            assert_eq!(ver, super::migrations::latest_schema_version().to_string());
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

    /// 启动自愈路径：实库损坏（quick_check 不过）时，用 Backups/ 内最新
    /// pre_import/pre_restore 安全备份文件级恢复，损坏原文件改名留存为 .corrupt-*。
    #[test]
    fn database_new_recovers_corrupt_db_from_safety_backup() {
        let base = std::env::temp_dir().join(format!("tl_recover_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let backups = base.join(BACKUPS_DIR_NAME);
        std::fs::create_dir_all(&backups).unwrap();
        // 安全备份：一个正常初始化的库（含标记行）
        let backup = backups.join("taglauncher_pre_import_20260101_000000_000.db");
        {
            let db = Database::new(&backup).expect("seed backup db");
            db.get_conn()
                .execute(
                    "INSERT INTO items (name, path, type) VALUES ('survivor', 'D:\\s.exe', 'exe')",
                    [],
                )
                .unwrap();
        }
        // 实库损坏：垃圾字节，quick_check 必不过
        let live = base.join("taglauncher.db");
        std::fs::write(&live, b"not a sqlite database at all").unwrap();

        let db = Database::new(&live).expect("应从安全备份自愈恢复");
        let name: String = db
            .get_conn()
            .query_row("SELECT name FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "survivor", "恢复后应读到备份中的数据");
        let leftover = std::fs::read_dir(&base)
            .unwrap()
            .flatten()
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("taglauncher.db.corrupt-")
            });
        assert!(leftover, "损坏原文件应改名留存为 .corrupt-*");

        let _ = std::fs::remove_dir_all(&base);
    }
}

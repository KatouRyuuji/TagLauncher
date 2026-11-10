use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use super::migrations;
use super::schema;

/// 数据库管理结构体
/// 通过 `app.manage(database)` 注入 Tauri 状态，命令函数通过 `State<Database>` 获取
pub struct Database {
    conn: Mutex<Connection>,
    /// 实库路径（只读连接按需打开；内存库/测试库为 None 时不提供只读连接）
    path: std::path::PathBuf,
    /// 只读第二连接（WAL 下读不阻塞写）：给外部写入检测与后续快速窗用；首次使用时打开，
    /// tl CLI 等不用它的场景不付出代价
    read: Mutex<Option<Connection>>,
}

impl Database {
    /// 创建数据库实例并初始化表结构
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = open_or_recover(path)?;
        let db = Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
            read: Mutex::new(None),
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

    /// 写连接的 `PRAGMA data_version`：只在**其他连接**（含其他进程，如 tl）提交后变化，
    /// 本连接自己的提交不改变它。写连接正被长事务占用时返回 None（不排队等待，下次再查）。
    pub fn try_write_data_version(&self) -> Option<i64> {
        let conn = match self.conn.try_lock() {
            Ok(c) => c,
            Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return None,
        };
        data_version(&conn).ok()
    }

    /// 只读连接（按需打开）。打开失败返回 Err，调用方降级（不影响写路径）。
    pub fn read_conn(&self) -> Result<ReadConn<'_>, String> {
        let mut guard = self.read.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            *guard = Some(open_read_only(&self.path).map_err(|e| format!("打开只读连接失败：{e}"))?);
        }
        Ok(ReadConn(guard))
    }

    /// 只读连接的 `PRAGMA data_version`：任何其他连接（本进程写连接或外部进程）提交后都会变化。
    pub fn read_data_version(&self) -> Result<i64, String> {
        let guard = self.read_conn()?;
        data_version(guard.conn()).map_err(|e| e.to_string())
    }
}

/// 只读连接守卫：持有锁期间 `conn()` 必然可用（`read_conn` 已保证打开）。
pub struct ReadConn<'a>(std::sync::MutexGuard<'a, Option<Connection>>);

impl ReadConn<'_> {
    pub fn conn(&self) -> &Connection {
        self.0.as_ref().expect("read_conn 已打开只读连接")
    }
}

fn data_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row("PRAGMA data_version", [], |r| r.get(0))
}

/// 只读打开实库：不建表、不迁移（写连接已完成），query_only 双保险；与写连接同样的 busy_timeout。
fn open_read_only(path: &Path) -> Result<Connection, rusqlite::Error> {
    use rusqlite::OpenFlags;
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
    )?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.execute_batch("PRAGMA query_only = ON; PRAGMA temp_store = MEMORY;")?;
    Ok(conn)
}

/// 打开实库；quick_check 判定库已损坏时，先用 Backups/ 内最新安全备份做文件级
/// 自愈恢复再打开。导入/云端恢复的实库覆盖只走 SQLite 逻辑层（Backup API），进程崩溃
/// /断电可能留下打不开的实库——逻辑回滚救不了这种情况，自愈是最后防线。
/// 权限、磁盘读写、锁冲突等非损坏错误原样报错，不动实库。
fn open_or_recover(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    let check = conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0));
    if !is_corruption(&check) {
        return check.map(|_| conn);
    }
    // 先释放句柄，Windows 下才能改名/覆盖损坏文件
    drop(conn);
    recover_from_safety_backup(path);
    let conn = Connection::open(path)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    Ok(conn)
}

/// 遇到其它连接持锁时的最长等待：GUI 与 tl 跨进程共用实库，写冲突排队而非立即报
/// "database is locked"。
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// quick_check 结果是否表明库已损坏：返回问题描述行（通过时恰为单行 "ok"），
/// 或 SQLite 报 CORRUPT / NOTADB。
fn is_corruption(check: &Result<String, rusqlite::Error>) -> bool {
    match check {
        Ok(first) => first != "ok",
        Err(e) => matches!(
            e.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase)
        ),
    }
}

/// 备份目录名（与 data_commands::BACKUPS_DIR_NAME 保持一致）。
const BACKUPS_DIR_NAME: &str = "Backups";

/// 可用于自愈的备份文件名前缀：自动、导入前、云端恢复前、手动备份。
const RECOVERY_BACKUP_PREFIXES: [&str; 4] = [
    "taglauncher_auto_",
    "taglauncher_pre_import_",
    "taglauncher_pre_restore_",
    "taglauncher_backup_",
];

/// 在备份目录中按文件名里的 UTC 时间戳选出最新的可自愈备份。
fn latest_recovery_backup(backups_dir: &Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(backups_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            let stamp = RECOVERY_BACKUP_PREFIXES
                .iter()
                .find_map(|prefix| name.strip_prefix(prefix))?
                .strip_suffix(".db")?
                .to_string();
            Some((stamp, e.path()))
        })
        .max()
        .map(|(_, path)| path)
}

/// 用 Backups/ 里最新的备份文件级覆盖实库。
/// 损坏原文件改名留存为 .corrupt-<epoch> 供人工排查；无可用备份时保持原状，
/// 让后续打开按原样报错（行为与不自愈一致）。
fn recover_from_safety_backup(path: &Path) {
    let Some(dir) = path.parent() else { return };
    let Some(backup) = latest_recovery_backup(&dir.join(BACKUPS_DIR_NAME)) else {
        log::error!("[db] 实库 {:?} 打开/完整性校验失败，且无备份可自愈", path);
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
        log::error!("[db] 损坏实库改名留存失败({})，放弃自愈", e);
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
        Ok(_) => log::warn!(
            "[db] 实库损坏，已用安全备份 {:?} 自愈恢复；损坏文件留存为 {:?}",
            backup, corrupt
        ),
        Err(e) => {
            log::error!("[db] 从安全备份 {:?} 恢复失败: {}", backup, e);
            // 尽力把损坏文件放回原位，保持故障现场可人工处理
            let _ = std::fs::rename(&corrupt, path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(tag: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("tl_{tag}_{}.db", std::process::id()));
        let p = path.to_string_lossy().to_string();
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
        path
    }

    /// data_version 语义：写连接只感知「别的连接」的提交（外部进程写入）；只读连接感知所有提交。
    #[test]
    fn data_version_distinguishes_external_from_own_commits() {
        let path = temp_db("dv");
        let db = Database::new(&path).expect("db");
        let w0 = db.try_write_data_version().expect("write dv");
        let r0 = db.read_data_version().expect("read dv");
        // 本进程写连接提交：写连接不变，只读连接变化（= 本应用写入，应广播 origin=app）
        db.get_conn().execute("INSERT INTO tags (name) VALUES ('own')", []).unwrap();
        assert_eq!(db.try_write_data_version(), Some(w0), "自身提交不改变写连接 data_version");
        let r1 = db.read_data_version().unwrap();
        assert_ne!(r1, r0, "只读连接应看到写连接的提交");
        // 外部连接（模拟 tl 进程）提交：写连接与只读连接都变化（= 外部写入，应刷新主窗）
        {
            let other = Connection::open(&path).unwrap();
            other.busy_timeout(BUSY_TIMEOUT).unwrap();
            other.execute("INSERT INTO tags (name) VALUES ('external')", []).unwrap();
        }
        assert_ne!(db.try_write_data_version(), Some(w0), "外部提交改变写连接 data_version");
        assert_ne!(db.read_data_version().unwrap(), r1);
        // 写连接被占用时不阻塞
        let held = db.get_conn();
        assert_eq!(db.try_write_data_version(), None, "写连接被占用时立即返回 None");
        drop(held);
        drop(db);
        let p = path.to_string_lossy().to_string();
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
    }

    /// 只读连接：能读到写连接已提交的数据，且任何写入都被拒绝。
    #[test]
    fn read_connection_sees_commits_and_rejects_writes() {
        let path = temp_db("ro");
        let db = Database::new(&path).expect("db");
        db.get_conn().execute("INSERT INTO tags (name) VALUES ('可见')", []).unwrap();
        {
            let ro = db.read_conn().expect("open ro");
            let n: i64 = ro.conn().query_row("SELECT COUNT(*) FROM tags WHERE name='可见'", [], |r| r.get(0)).unwrap();
            assert_eq!(n, 1);
            assert!(ro.conn().execute("INSERT INTO tags (name) VALUES ('x')", []).is_err(), "只读连接必须拒绝写入");
        }
        drop(db);
        let p = path.to_string_lossy().to_string();
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
    }

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
    /// 备份文件级恢复，损坏原文件改名留存为 .corrupt-*。
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

    fn is_lock_error(e: &rusqlite::Error) -> bool {
        matches!(
            e.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
        )
    }

    #[test]
    fn only_corruption_triggers_recovery() {
        use rusqlite::ffi;
        let sqlite_err = |code| Err(rusqlite::Error::SqliteFailure(ffi::Error::new(code), None));
        assert!(!is_corruption(&Ok("ok".to_string())));
        assert!(is_corruption(&Ok("*** in database main ***".to_string())));
        assert!(is_corruption(&sqlite_err(ffi::SQLITE_CORRUPT)));
        assert!(is_corruption(&sqlite_err(ffi::SQLITE_NOTADB)));
        for code in [
            ffi::SQLITE_IOERR,
            ffi::SQLITE_CANTOPEN,
            ffi::SQLITE_BUSY,
            ffi::SQLITE_READONLY,
        ] {
            assert!(!is_corruption(&sqlite_err(code)), "code {code}");
        }
    }

    /// 在独立线程用排它锁占住实库 hold 时长后释放；返回加锁完成后的 join 句柄。
    fn hold_exclusive_lock(path: &Path, hold: Duration) -> std::thread::JoinHandle<()> {
        let path = path.to_path_buf();
        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;")
                .unwrap();
            locked_tx.send(()).unwrap();
            std::thread::sleep(hold);
            conn.execute_batch("COMMIT").unwrap();
        });
        locked_rx.recv().unwrap();
        handle
    }

    fn seeded_db(dir_name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("{dir_name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let live = base.join("taglauncher.db");
        Database::new(&live).expect("seed live db");
        (base, live)
    }

    /// 另一连接短暂持锁时，打开与写入排队等待，锁释放后成功。
    #[test]
    fn database_new_waits_for_short_lock() {
        let (base, live) = seeded_db("tl_busy_wait");
        let holder = hold_exclusive_lock(&live, Duration::from_millis(500));

        let db = Database::new(&live).expect("锁释放后应正常打开");
        db.get_conn()
            .execute(
                "INSERT INTO items (name, path, type) VALUES ('w', 'D:\\w.exe', 'exe')",
                [],
            )
            .expect("锁释放后应能写入");
        holder.join().unwrap();

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 等锁超时按锁错误原样报错：不改名留存、不从安全备份覆盖实库。
    #[test]
    fn database_new_reports_lock_timeout_without_recovery() {
        let (base, live) = seeded_db("tl_busy_timeout");
        let backups = base.join(BACKUPS_DIR_NAME);
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::copy(
            &live,
            backups.join("taglauncher_pre_import_20260101_000000_000.db"),
        )
        .unwrap();
        let holder = hold_exclusive_lock(&live, BUSY_TIMEOUT + Duration::from_secs(2));

        let err = match Database::new(&live) {
            Ok(_) => panic!("持锁超过等待上限时应报错"),
            Err(e) => e,
        };
        assert!(is_lock_error(&err), "应为锁错误: {err}");
        holder.join().unwrap();
        let renamed = std::fs::read_dir(&base).unwrap().flatten().any(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("taglauncher.db.corrupt-")
        });
        assert!(!renamed, "锁冲突不应触发自愈");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn latest_recovery_backup_compares_timestamps_across_kinds() {
        let dir = std::env::temp_dir().join(format!("tl_latest_backup_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "taglauncher_pre_restore_20260301_000000_000.db",
            "taglauncher_auto_20260105_000000_000.db",
            "taglauncher_backup_20260302_000000_000.db",
            "taglauncher_pre_import_20260201_000000_000.db",
            "taglauncher_auto_20260401_000000_000.db.tmp",
            "taglauncher_20260501_000000_000.db",
        ] {
            std::fs::write(dir.join(name), b"").unwrap();
        }

        let latest = latest_recovery_backup(&dir).unwrap();
        assert_eq!(
            latest.file_name().unwrap(),
            "taglauncher_backup_20260302_000000_000.db"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

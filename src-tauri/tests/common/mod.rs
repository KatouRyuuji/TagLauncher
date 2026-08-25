//! 集成测试共享 helper：为每个测试建独立的**真实磁盘** SQLite 文件库（跑完整迁移链）。
//!
//! 用真实文件库（而非内存库）是刻意的——WAL、破坏性迁移的 VACUUM 备份、在线备份等
//! 只在磁盘文件上才有意义。每个测试用独立临时目录，Drop 时整目录递归清理。
//!
//! 不引入 tempfile crate（未在依赖内）——用 进程id + 原子计数 + 纳秒 组合命名保证唯一，
//! 手写 Drop 清理。
//!
//! 用法：
//! ```ignore
//! let t = common::temp_db();       // 守卫务必绑定具名变量，存活至测试结束
//! let conn = t.db.get_conn();
//! ```

// 各测试文件（独立编译单元）按需使用部分 helper；未用到的在该单元里不算错误。
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tag_launcher_lib::db::Database;

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// 独立临时目录守卫：Drop 时递归清理整个目录
/// （含 .db / -wal / -shm / *.pre-v*.bak / Backups 子目录等所有旁生文件）。
pub struct TempDir {
    pub path: PathBuf,
}

impl TempDir {
    pub fn new(label: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut path = std::env::temp_dir();
        path.push(format!("tl_it_{}_{}_{}_{}", label, std::process::id(), n, nanos));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create temp test dir");
        TempDir { path }
    }

    /// 该临时目录下的默认库文件路径。
    pub fn db_path(&self) -> PathBuf {
        self.path.join("taglauncher.db")
    }

    /// 该临时目录下的任意子路径。
    pub fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // best-effort：清理失败（如 Windows 句柄未及时释放）不影响测试结论。
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// 真实文件库 + 目录守卫。字段声明顺序即 Drop 顺序：
/// `db` 先 Drop（关闭连接、释放文件句柄），随后 `dir` 再清理磁盘文件——
/// 确保 Windows 下不因文件占用而清理失败。
pub struct TestDb {
    pub db: Database,
    pub dir: TempDir,
}

/// 建一个真实磁盘文件库：Database::new 会启用 WAL 并跑完 v001..v008 迁移链。
pub fn temp_db() -> TestDb {
    let dir = TempDir::new("db");
    let db = Database::new(&dir.db_path()).expect("init real file db");
    TestDb { db, dir }
}

/// 在临时目录下写一个真实文件，返回其绝对路径字符串。
pub fn write_file(dir: &TempDir, rel: &str, bytes: &[u8]) -> String {
    let p = dir.path.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("create parent dir");
    }
    std::fs::write(&p, bytes).expect("write temp file");
    p.to_string_lossy().to_string()
}

/// 在临时目录下建一个真实子目录，返回其绝对路径字符串。
pub fn make_dir(dir: &TempDir, rel: &str) -> String {
    let p = dir.path.join(rel);
    std::fs::create_dir_all(&p).expect("create temp subdir");
    p.to_string_lossy().to_string()
}

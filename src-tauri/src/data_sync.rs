//! 数据同步（全局极速阶段①）：提交后广播 + 外部写入检测。
//!
//! 机制：`PRAGMA data_version`（SQLite 官方给「把库内容缓存在屏幕上的程序」判断是否需要重载用）。
//! - 写连接的 data_version 只在**其他连接**提交后变化 → 外部进程（tl 等）写入；
//! - 只读连接的 data_version 在任何连接提交后变化 → 写连接变了而外部没变 = 本应用写入。
//!
//! 检测线程：主窗可见时每 [`VISIBLE_INTERVAL`] 查一次（两次 PRAGMA，微秒级、不读表），
//! 隐藏/最小化时降到 [`HIDDEN_INTERVAL`]；窗口获焦、托盘/热键唤出时立即查（[`poke`]）。
//! 不读文件、不扫表、不持写锁等待（写连接被长事务占用时跳过本轮）。
//!
//! 事件 `data-changed` 只在提交成功后发出（data_version 只反映已提交事务），发给所有窗口。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::Database;

pub const DATA_CHANGED_EVENT: &str = "data-changed";
/// 主窗可见时的检测间隔：外部写入到主窗反映的目标是 0.3 秒（检测 ≤100ms + 合并 16ms + 重载）。
/// 每轮只有两次 PRAGMA data_version（读共享内存里的计数，不读表），每秒 10 次的开销可忽略。
pub const VISIBLE_INTERVAL: Duration = Duration::from_millis(100);
/// 主窗可见时每多少轮重新查询一次可见性（5 × 100ms = 0.5 秒）。
const VISIBILITY_EVERY: u32 = 5;
/// 主窗隐藏/最小化时的检测间隔；唤出时会立即检测一次，不依赖这个间隔。
pub const HIDDEN_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeOrigin {
    /// 其他进程（tl CLI、另一个工具）写库：窗口需重新加载
    External,
    /// 本应用写库（任何窗口或后台任务）：发起方已自行更新，其他窗口按需刷新
    App,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataChanged {
    pub origin: ChangeOrigin,
    pub seq: u64,
    /// 检测到变化的时刻（Unix 毫秒），便于前端/测试度量端到端延迟
    pub detected_at_ms: u64,
}

/// 两个 data_version 的观测器（纯逻辑，便于单测）。
#[derive(Debug, Default)]
pub struct VersionTracker {
    write: Option<i64>,
    read: Option<i64>,
}

impl VersionTracker {
    /// `write` 为 None 表示写连接正忙（本轮无法区分来源）：不更新基线，下轮再判。
    /// 首次观测只建立基线。外部与本应用同一轮都有提交时按外部处理（全量重载覆盖两者）。
    pub fn observe(&mut self, write: Option<i64>, read: i64) -> Option<ChangeOrigin> {
        let write = write?;
        let (prev_w, prev_r) = (self.write, self.read);
        self.write = Some(write);
        self.read = Some(read);
        let (prev_w, prev_r) = (prev_w?, prev_r?);
        if write != prev_w {
            Some(ChangeOrigin::External)
        } else if read != prev_r {
            Some(ChangeOrigin::App)
        } else {
            None
        }
    }
}

static WAKE: OnceLock<Mutex<Sender<()>>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);
static READ_WARNED: AtomicBool = AtomicBool::new(false);

/// 立即检测一次（窗口获焦、唤出时调用）。检测线程未启动时无操作。
pub fn poke() {
    if let Some(tx) = WAKE.get() {
        let _ = tx.lock().unwrap_or_else(|p| p.into_inner()).send(());
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 主窗或快速搜索窗有一个在显示，就按可见间隔检测
fn any_window_visible(app: &AppHandle) -> bool {
    ["main", crate::quick::QUICK_LABEL].iter().any(|label| {
        app.get_webview_window(label)
            .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
    })
}

/// 检测一轮：有变化时广播并返回来源。
pub fn check_once(app: &AppHandle, tracker: &mut VersionTracker) -> Option<ChangeOrigin> {
    let db = app.try_state::<Database>()?;
    let read = match db.read_data_version() {
        Ok(v) => v,
        Err(e) => {
            // 只记一次，避免每 100ms 刷屏
            if !READ_WARNED.swap(true, Ordering::Relaxed) {
                log::warn!("data_sync: 只读连接不可用，外部写入检测暂停：{e}");
            }
            return None;
        }
    };
    let origin = tracker.observe(db.try_write_data_version(), read)?;
    let payload = DataChanged {
        origin,
        seq: SEQ.fetch_add(1, Ordering::Relaxed) + 1,
        detected_at_ms: now_ms(),
    };
    let _ = app.emit(DATA_CHANGED_EVENT, payload);
    Some(origin)
}

/// 启动检测线程（应用 setup 后调用一次）。
pub fn start(app: &AppHandle) {
    let (tx, rx): (Sender<()>, Receiver<()>) = mpsc::channel();
    if WAKE.set(Mutex::new(tx)).is_err() {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-data-sync".into())
        .spawn(move || {
            let mut tracker = VersionTracker::default();
            // 建立基线：启动前已发生的写入由首屏加载覆盖
            check_once(&app, &mut tracker);
            // 可见性查询要跨线程到主线程，按 VISIBILITY_EVERY 轮刷新一次；唤醒（获焦/唤出）时立即刷新
            let mut visible = any_window_visible(&app);
            let mut ticks: u32 = 0;
            loop {
                let interval = if visible {
                    VISIBLE_INTERVAL
                } else {
                    HIDDEN_INTERVAL
                };
                let woken = match rx.recv_timeout(interval) {
                    Ok(()) => {
                        // 合并短时间内的多次唤醒
                        while rx.try_recv().is_ok() {}
                        true
                    }
                    Err(RecvTimeoutError::Timeout) => false,
                    Err(RecvTimeoutError::Disconnected) => return,
                };
                check_once(&app, &mut tracker);
                ticks = ticks.wrapping_add(1);
                if woken || !visible || ticks % VISIBILITY_EVERY == 0 {
                    visible = any_window_visible(&app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_observation_is_baseline_only() {
        let mut t = VersionTracker::default();
        assert_eq!(t.observe(Some(1), 1), None);
        assert_eq!(t.observe(Some(1), 1), None, "无变化不广播");
    }

    #[test]
    fn own_commit_is_app_and_external_commit_is_external() {
        let mut t = VersionTracker::default();
        t.observe(Some(1), 1);
        assert_eq!(
            t.observe(Some(1), 2),
            Some(ChangeOrigin::App),
            "只读连接变、写连接不变 = 本应用写入"
        );
        assert_eq!(
            t.observe(Some(2), 3),
            Some(ChangeOrigin::External),
            "写连接变 = 外部进程写入"
        );
        assert_eq!(t.observe(Some(2), 3), None);
    }

    #[test]
    fn busy_write_connection_defers_without_losing_change() {
        let mut t = VersionTracker::default();
        t.observe(Some(1), 1);
        assert_eq!(t.observe(None, 2), None, "写连接忙：本轮不判");
        assert_eq!(
            t.observe(Some(2), 2),
            Some(ChangeOrigin::External),
            "下一轮仍能发现外部写入"
        );
    }

    #[test]
    fn payload_serializes_for_frontend() {
        let p = DataChanged {
            origin: ChangeOrigin::External,
            seq: 3,
            detected_at_ms: 9,
        };
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"origin": "external", "seq": 3, "detectedAtMs": 9})
        );
    }

    /// 端到端（不经 Tauri）：真实库 + 外部连接提交 → 观测为 External；本连接提交 → App。
    #[test]
    fn tracker_with_real_database_versions() {
        let path = std::env::temp_dir().join(format!("tl_sync_{}.db", std::process::id()));
        let p = path.to_string_lossy().to_string();
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
        let db = Database::new(&path).unwrap();
        let mut t = VersionTracker::default();
        let probe = |t: &mut VersionTracker| {
            t.observe(db.try_write_data_version(), db.read_data_version().unwrap())
        };
        assert_eq!(probe(&mut t), None);
        db.get_conn()
            .execute("INSERT INTO tags (name) VALUES ('a')", [])
            .unwrap();
        assert_eq!(probe(&mut t), Some(ChangeOrigin::App));
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute("INSERT INTO tags (name) VALUES ('b')", [])
            .unwrap();
        assert_eq!(probe(&mut t), Some(ChangeOrigin::External));
        assert_eq!(probe(&mut t), None);
        drop(db);
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
    }
}

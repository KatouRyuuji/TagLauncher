use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use notify_debouncer_full::notify::event::{ModifyKind, RenameMode};
use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Database;

use super::{reconcile_runtime, watch_service};

/// 变更通知防抖窗口：合并改名两段事件与连续写入。
const DEBOUNCE: Duration = Duration::from_millis(800);
/// 已挂上通知的根：低频全量补扫兜底；未挂上的根（离线/挂载失败）也按此间隔重试挂载。
const FULL_SCAN_INTERVAL: Duration = Duration::from_secs(600);
/// 根目录在线但挂不上通知（如部分网络盘）时退回轮询补扫的间隔。
const POLL_INTERVAL: Duration = Duration::from_secs(60);
/// 工作线程检查停止标志与到期补扫的粒度。
const WAKE_INTERVAL: Duration = Duration::from_secs(1);

/// 进程内监视调度：总闸/对象开关变化时整表重载；单个工作线程串行处理所有根的
/// 变更通知与到期补扫，写库不并发。
pub struct FolderWatchHub {
    inner: Mutex<HubInner>,
}

struct HubInner {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl FolderWatchHub {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HubInner {
                stop: Arc::new(AtomicBool::new(false)),
                worker: None,
            }),
        }
    }

    pub fn reload(&self, app: &AppHandle) {
        let mut inner = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        inner.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = inner.worker.take() {
            let _ = handle.join();
        }
        let stop = Arc::new(AtomicBool::new(false));
        inner.stop = stop.clone();

        let roots = {
            let db = app.state::<Database>();
            let conn = db.get_conn();
            watch_service::list_active_roots(&conn).unwrap_or_default()
        };
        if roots.is_empty() {
            return;
        }
        let app = app.clone();
        inner.worker = Some(thread::spawn(move || worker_loop(app, roots, stop)));
    }
}

type RootDebouncer = Debouncer<RecommendedWatcher, RecommendedCache>;

struct RootState {
    item_id: i64,
    path: PathBuf,
    debouncer: Option<RootDebouncer>,
    next_scan: Instant,
}

/// 事件分类结果：需入库的路径、是否需对账（删除/移出/改名）、是否需全量补扫（通知溢出/报错）。
#[derive(Default, Debug, PartialEq)]
struct EventPlan {
    import: Vec<PathBuf>,
    reconcile: bool,
    rescan: bool,
}

fn plan_events(result: DebounceEventResult) -> EventPlan {
    let mut plan = EventPlan::default();
    let events = match result {
        Ok(events) => events,
        Err(_) => {
            plan.rescan = true;
            return plan;
        }
    };
    for event in events {
        if event.need_rescan() {
            plan.rescan = true;
            continue;
        }
        match event.kind {
            EventKind::Create(_) => plan.import.extend(event.paths.iter().cloned()),
            EventKind::Modify(ModifyKind::Name(mode)) => {
                plan.reconcile = true;
                if matches!(mode, RenameMode::To | RenameMode::Both) {
                    plan.import.extend(event.paths.last().cloned());
                }
            }
            EventKind::Remove(_) => plan.reconcile = true,
            _ => {}
        }
    }
    plan
}

fn attach(state: &mut RootState, index: usize, tx: &Sender<(usize, DebounceEventResult)>) {
    let tx = tx.clone();
    let mut debouncer = match new_debouncer(DEBOUNCE, None, move |result| {
        let _ = tx.send((index, result));
    }) {
        Ok(debouncer) => debouncer,
        Err(error) => {
            log::warn!("[folder-watch] 根 {} 创建监视失败: {error}", state.item_id);
            return;
        }
    };
    match debouncer.watch(&state.path, RecursiveMode::Recursive) {
        Ok(()) => state.debouncer = Some(debouncer),
        Err(error) => log::warn!(
            "[folder-watch] 根 {} 挂载变更通知失败，退回 {}s 轮询: {error}",
            state.item_id,
            POLL_INTERVAL.as_secs()
        ),
    }
}

fn emit_imported(app: &AppHandle, created_count: usize) {
    if created_count > 0 {
        let _ = app.emit(
            "folder-watch-imported",
            serde_json::json!({ "createdCount": created_count }),
        );
    }
}

/// 全量补扫一个根：离线时跳过；在线但未挂上通知时先尝试挂载。
fn full_scan(
    app: &AppHandle,
    state: &mut RootState,
    index: usize,
    tx: &Sender<(usize, DebounceEventResult)>,
) {
    let online = state.path.is_dir();
    if online && state.debouncer.is_none() {
        attach(state, index, tx);
    }
    state.next_scan = Instant::now()
        + if online && state.debouncer.is_none() {
            POLL_INTERVAL
        } else {
            FULL_SCAN_INTERVAL
        };
    if !online {
        return;
    }
    let db = app.state::<Database>();
    match watch_service::scan_root(&db, state.item_id) {
        Ok(result) => emit_imported(app, result.created_count),
        Err(error) => log::warn!("[folder-watch] 根 {} 补扫失败: {error}", state.item_id),
    }
}

fn worker_loop(app: AppHandle, roots: Vec<(i64, String)>, stop: Arc<AtomicBool>) {
    let (tx, rx): (Sender<(usize, DebounceEventResult)>, Receiver<_>) = mpsc::channel();
    let now = Instant::now();
    let mut states: Vec<RootState> = roots
        .into_iter()
        .map(|(item_id, path)| RootState {
            item_id,
            path: PathBuf::from(path),
            debouncer: None,
            next_scan: now,
        })
        .collect();

    while !stop.load(Ordering::Relaxed) {
        for (index, state) in states.iter_mut().enumerate() {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            if Instant::now() >= state.next_scan {
                full_scan(&app, state, index, &tx);
            }
        }
        let (index, result) = match rx.recv_timeout(WAKE_INTERVAL) {
            Ok(message) => message,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => continue,
        };
        let Some(state) = states.get_mut(index) else {
            continue;
        };
        let plan = plan_events(result);
        if plan.rescan {
            log::warn!(
                "[folder-watch] 根 {} 变更通知溢出或报错，安排全量补扫",
                state.item_id
            );
            state.next_scan = Instant::now();
        }
        if !plan.import.is_empty() {
            let db = app.state::<Database>();
            match watch_service::import_event_paths(&db, state.item_id, &plan.import) {
                Ok(result) => emit_imported(&app, result.created_count),
                Err(error) => {
                    log::warn!("[folder-watch] 根 {} 增量入库失败: {error}", state.item_id)
                }
            }
        }
        if plan.reconcile {
            reconcile_runtime::request_reconcile(&app, true);
        }
    }
    // states 析构时各 Debouncer 停止并释放系统句柄
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::notify::event::{CreateKind, Flag, RemoveKind};
    use notify_debouncer_full::notify::Event;
    use notify_debouncer_full::DebouncedEvent;

    fn debounced(event: Event) -> DebouncedEvent {
        DebouncedEvent::new(event, Instant::now())
    }

    #[test]
    fn create_imports_and_remove_reconciles() {
        let plan = plan_events(Ok(vec![
            debounced(Event::new(EventKind::Create(CreateKind::Any)).add_path("D:/r/a.mp4".into())),
            debounced(Event::new(EventKind::Remove(RemoveKind::Any)).add_path("D:/r/b.mp4".into())),
        ]));
        assert_eq!(plan.import, vec![PathBuf::from("D:/r/a.mp4")]);
        assert!(plan.reconcile);
        assert!(!plan.rescan);
    }

    #[test]
    fn rename_imports_new_path_and_reconciles() {
        let plan = plan_events(Ok(vec![debounced(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path("D:/r/old.mp4".into())
                .add_path("D:/r/new.mp4".into()),
        )]));
        assert_eq!(plan.import, vec![PathBuf::from("D:/r/new.mp4")]);
        assert!(plan.reconcile);
    }

    #[test]
    fn rename_from_only_reconciles() {
        let plan = plan_events(Ok(vec![debounced(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .add_path("D:/r/gone.mp4".into()),
        )]));
        assert!(plan.import.is_empty());
        assert!(plan.reconcile);
    }

    #[test]
    fn content_changes_are_ignored() {
        let plan = plan_events(Ok(vec![debounced(
            Event::new(EventKind::Modify(ModifyKind::Any)).add_path("D:/r/a.mp4".into()),
        )]));
        assert_eq!(plan, EventPlan::default());
    }

    #[test]
    fn overflow_and_errors_request_rescan() {
        let plan = plan_events(Ok(vec![debounced(
            Event::new(EventKind::Other).set_flag(Flag::Rescan),
        )]));
        assert!(plan.rescan);
        let plan = plan_events(Err(vec![notify_debouncer_full::notify::Error::generic(
            "boom",
        )]));
        assert!(plan.rescan);
    }

    /// 真实系统变更通知：新建文件后数秒内收到可入库的事件（需真实 Windows，Wine 下不保证）。
    #[test]
    fn real_notification_delivers_created_file() {
        let root = std::env::temp_dir().join(format!("tl_watch_rt_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut state = RootState {
            item_id: 1,
            path: root.clone(),
            debouncer: None,
            next_scan: Instant::now(),
        };
        attach(&mut state, 0, &tx);
        assert!(state.debouncer.is_some(), "挂载变更通知失败");
        let file = root.join("fresh.mp4");
        std::fs::write(&file, b"x").unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut seen = false;
        while Instant::now() < deadline && !seen {
            if let Ok((index, result)) = rx.recv_timeout(Duration::from_millis(200)) {
                assert_eq!(index, 0);
                seen = plan_events(result)
                    .import
                    .iter()
                    .any(|p| p.ends_with("fresh.mp4"));
            }
        }
        drop(state);
        let _ = std::fs::remove_dir_all(&root);
        assert!(seen, "5 秒内未收到新建文件的变更通知");
    }
}

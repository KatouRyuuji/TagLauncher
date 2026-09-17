use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::Database;

use super::watch_service;

/// 进程内监视调度：总闸/对象开关变化时整表重载；每根独立线程做有界轮询补扫。
pub struct FolderWatchHub {
    inner: Mutex<HubInner>,
}

struct HubInner {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl FolderWatchHub {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HubInner {
                stop: Arc::new(AtomicBool::new(false)),
                threads: Vec::new(),
            }),
        }
    }

    pub fn reload(&self, app: &AppHandle) {
        let mut inner = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        inner.stop.store(true, Ordering::SeqCst);
        for handle in inner.threads.drain(..) {
            let _ = handle.join();
        }
        let stop = Arc::new(AtomicBool::new(false));
        inner.stop = stop.clone();

        let roots = {
            let db = app.state::<Database>();
            let conn = db.get_conn();
            watch_service::list_active_roots(&conn).unwrap_or_default()
        };

        for (item_id, path) in roots {
            let app = app.clone();
            let stop = stop.clone();
            inner.threads.push(thread::spawn(move || watch_loop(app, item_id, path, stop)));
        }
    }
}

fn watch_loop(app: AppHandle, item_id: i64, _path: String, stop: Arc<AtomicBool>) {
    tick(&app, item_id);
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(1500));
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let active = {
            let db = app.state::<Database>();
            let conn = db.get_conn();
            watch_service::root_is_active(&conn, item_id)
        };
        if !active {
            break;
        }
        tick(&app, item_id);
    }
}

fn tick(app: &AppHandle, item_id: i64) {
    let db = app.state::<Database>();
    match watch_service::scan_root(&db, item_id) {
        Ok(result) if result.created_count > 0 => {
            let _ = app.emit(
                "folder-watch-imported",
                serde_json::json!({ "createdCount": result.created_count }),
            );
        }
        Ok(_) => {}
        Err(error) => eprintln!("[folder-watch] 根 {item_id} 补扫失败: {error}"),
    }
}

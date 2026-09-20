// ============================================================================
// services/reconcile_runtime.rs — 对账调度（读取与对账解耦后的唯一触发口）
// ----------------------------------------------------------------------------
// get_items / get_cabinet_items 已纯读化（不再内联对账）。对账统一由本模块
// 调度：启动后 ~2s 首跑、60s 周期节流、手动刷新/命令强制触发。
// 执行沿用服务层三段式（锁内快照 → 锁外重 IO 计划 → 锁内批量回写），
// in_flight 防慢盘重入；有实际写入才 emit `items-reconciled`（摘要负载），
// 前端监听后走纯读的 loadAll。
// ============================================================================

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::services::item_service::{self, ReconcileWrite};

const THROTTLE: Duration = Duration::from_secs(60);

pub struct ReconcileScheduler {
    last_run: Mutex<Option<Instant>>,
    in_flight: AtomicBool,
}

impl ReconcileScheduler {
    pub fn new() -> Self {
        Self {
            last_run: Mutex::new(None),
            in_flight: AtomicBool::new(false),
        }
    }
}

#[derive(serde::Serialize, Clone)]
pub struct ReconcileSummary {
    /// wait=true：本遍是否有实际写入；wait=false：是否真启动了对账
    pub changed: bool,
    pub marked_missing: usize,
    pub relocated: usize,
    pub cleared: usize,
    pub elapsed_ms: u128,
}

fn summarize(writes: &[ReconcileWrite], elapsed: Duration) -> ReconcileSummary {
    let mut summary = ReconcileSummary {
        changed: !writes.is_empty(),
        marked_missing: 0,
        relocated: 0,
        cleared: 0,
        elapsed_ms: elapsed.as_millis(),
    };
    for write in writes {
        match write {
            ReconcileWrite::MarkMissing { .. } => summary.marked_missing += 1,
            ReconcileWrite::Relocate { .. } => summary.relocated += 1,
            ReconcileWrite::ClearMissing { .. } => summary.cleared += 1,
            ReconcileWrite::BackfillIdentity { .. } | ReconcileWrite::BackfillSignature { .. } => {}
        }
    }
    summary
}

/// 每块回写行数：整块提交会让 50k 级失效清扫长时间独占全局 DB 锁，
/// 读取（get_items）被挤到秒级；分块提交、块间释放锁让读取插队。
const APPLY_CHUNK_SIZE: usize = 500;

/// 同步跑一遍对账（调用方须在工作线程；慢盘/网络盘可能耗时秒级以上）。
/// 服务层行为零改动：快照/计划/回写与过期守卫全部沿用。
pub fn run_sweep(app: &AppHandle) -> Result<ReconcileSummary, String> {
    let started = Instant::now();
    let db = app.state::<crate::db::Database>();
    let snapshot = {
        let conn = db.get_conn();
        item_service::read_reconcile_snapshot(&conn)?
    };
    let writes = item_service::plan_reconcile(snapshot);
    let summary = summarize(&writes, started.elapsed());
    for chunk in writes.chunks(APPLY_CHUNK_SIZE) {
        {
            let conn = db.get_conn();
            item_service::apply_reconcile(&conn, chunk)?;
        }
        // 块间让出全局锁：大批量回写（如整盘失效）不再阻塞读取
        std::thread::yield_now();
    }
    Ok(summary)
}

/// 调度一次后台对账。force 绕过 60s 节流；已在跑或节流窗口内返回 false。
pub fn request_reconcile(app: &AppHandle, force: bool) -> bool {
    let scheduler = app.state::<ReconcileScheduler>();
    if scheduler.in_flight.swap(true, Ordering::SeqCst) {
        return false;
    }
    {
        let mut last = scheduler.last_run.lock().unwrap();
        if !force {
            if let Some(prev) = *last {
                if prev.elapsed() < THROTTLE {
                    scheduler.in_flight.store(false, Ordering::SeqCst);
                    return false;
                }
            }
        }
        *last = Some(Instant::now());
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        match run_sweep(&handle) {
            Ok(summary) => {
                if summary.changed {
                    let _ = handle.emit("items-reconciled", summary);
                }
            }
            Err(error) => eprintln!("[reconcile] 后台对账失败: {error}"),
        }
        handle
            .state::<ReconcileScheduler>()
            .in_flight
            .store(false, Ordering::SeqCst);
    });
    true
}

/// 60s 周期源：应用生命周期内常驻，节流窗口内自动跳过。
pub fn spawn_periodic(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(THROTTLE);
        request_reconcile(&handle, false);
    });
}

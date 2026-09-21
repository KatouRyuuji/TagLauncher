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
    /// 对账在跑期间到达的强制请求：登记后在跑完立即补一轮（手动刷新不再被静默丢弃）
    pending_force: AtomicBool,
    /// acquire/release 与 pending 登记的互斥门，防「登记 pending 与释放 in_flight」竞态
    gate: Mutex<()>,
}

impl ReconcileScheduler {
    pub fn new() -> Self {
        Self {
            last_run: Mutex::new(None),
            in_flight: AtomicBool::new(false),
            pending_force: AtomicBool::new(false),
            gate: Mutex::new(()),
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
    let mut applied = 0usize;
    for chunk in writes.chunks(APPLY_CHUNK_SIZE) {
        let result = {
            let conn = db.get_conn();
            item_service::apply_reconcile(&conn, chunk)
        };
        if let Err(error) = result {
            // 分块提交是为读取让锁，代价是中途失败不再全有或全无：
            // 已落库的部分先 emit 让前端如实反映，剩余写入由下一遍对账
            // （对账幂等：按最新快照重新计划）补齐，不留下无声的半成状态。
            let partial = summarize(&writes[..applied], started.elapsed());
            if partial.changed {
                let _ = app.emit("items-reconciled", partial);
            }
            return Err(format!(
                "对账回写中断（已应用 {applied}/{} 行，下一遍对账补齐）: {error}",
                writes.len()
            ));
        }
        applied += chunk.len();
        // 块间让出全局锁：大批量回写（如整盘失效）不再阻塞读取
        std::thread::yield_now();
    }
    Ok(summarize(&writes, started.elapsed()))
}

/// 调度一次后台对账。force 绕过 60s 节流；节流窗口内返回 false。
/// 对账在跑时：普通请求丢弃，强制请求登记 pending_force、在跑完立即补一轮。
pub fn request_reconcile(app: &AppHandle, force: bool) -> bool {
    let scheduler = app.state::<ReconcileScheduler>();
    {
        let _gate = scheduler.gate.lock().unwrap();
        if scheduler.in_flight.swap(true, Ordering::SeqCst) {
            if force {
                scheduler.pending_force.store(true, Ordering::SeqCst);
            }
            return false;
        }
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
        loop {
            match run_sweep(&handle) {
                Ok(summary) => {
                    if summary.changed {
                        let _ = handle.emit("items-reconciled", summary);
                    }
                }
                Err(error) => eprintln!("[reconcile] 后台对账失败: {error}"),
            }
            let scheduler = handle.state::<ReconcileScheduler>();
            let _gate = scheduler.gate.lock().unwrap();
            // 在跑期间登记的强制请求：in_flight 保持 true，立即补一轮
            if scheduler.pending_force.swap(false, Ordering::SeqCst) {
                continue;
            }
            scheduler.in_flight.store(false, Ordering::SeqCst);
            break;
        }
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

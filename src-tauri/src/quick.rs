//! 全局快速搜索窗（全局极速阶段②）。
//!
//! - 功能开关 = 「打开快速搜索」动作绑定了全局快捷键（默认不绑）。开启时在主窗首帧之后
//!   预创建隐藏的 `quick` 窗口并复用；关闭（清除快捷键）时销毁，不占资源。
//! - 唤出：定位到鼠标所在显示器的工作区（居中偏上）→ show → focus → 给快速窗发
//!   `quick-shown { t0Ms }`（t0 = 热键回调时刻，供前端度量「唤出到可输入」）。
//! - 数据：快速窗不加载全量对象，每次输入调 `quick_search`（与主窗同一个 Rust 内存索引，
//!   见 services::search_index）只取前 50 条；写操作（打标签）调用与主窗相同的命令，
//!   写后发 `window-data-written` 让主窗按 ID 增量刷新。

#[cfg(test)]
use crate::quick_lifecycle::may_block_for_ui_progress;
use crate::quick_lifecycle::{
    ensure_action, next_state_after_ensure, ui_hide_may_enter_ensure, DestroyState, EnsureAction,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const QUICK_LABEL: &str = "quick";
pub const QUICK_SHOWN_EVENT: &str = "quick-shown";
pub const QUICK_LOCATE_EVENT: &str = "quick-locate";
/// 快速窗逻辑尺寸
const QUICK_WIDTH: f64 = 680.0;
const QUICK_HEIGHT: f64 = 440.0;
/// 预创建延迟：避开主窗首屏加载
const PRECREATE_DELAY: Duration = Duration::from_millis(1500);
/// 隐藏超过这么久后把快速窗的 WebView2 降为低内存目标（MemoryUsageTargetLevel=Low，§3.3）；
/// 唤出时先恢复 Normal。不用 TrySuspend：恢复有延迟，和「极速」冲突。
const LOW_MEMORY_AFTER: Duration = Duration::from_secs(300);
pub const QUICK_MEMORY_EVENT: &str = "quick-memory-level";
pub const HIDE_ON_BLUR_KEY: &str = "quick.hide_on_blur";
pub const KEEP_INPUT_KEY: &str = "quick.keep_input";
pub const MONITOR_KEY: &str = "quick.monitor";

/// 快速窗唤出到哪块显示器
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuickMonitor {
    /// 鼠标所在显示器（默认）
    Cursor,
    /// 主窗所在显示器
    Main,
}

/// 快速窗选项（§3.1「失焦自动隐藏可设置；可选保留上次输入、唤出所在显示器」）。存 app_meta，
/// 默认值即原行为：失焦隐藏、保留上次输入（唤出时全选）、鼠标所在显示器。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickOptions {
    pub hide_on_blur: bool,
    pub keep_input: bool,
    pub monitor: QuickMonitor,
}

impl Default for QuickOptions {
    fn default() -> Self {
        Self {
            hide_on_blur: true,
            keep_input: true,
            monitor: QuickMonitor::Cursor,
        }
    }
}

impl QuickOptions {
    /// 从设置读：只有显式 "0" 关闭开关；显示器只认 "main"，其余按鼠标所在
    pub fn from_settings(get: impl Fn(&str) -> Option<String>) -> Self {
        let off = |k: &str| get(k).as_deref() == Some("0");
        Self {
            hide_on_blur: !off(HIDE_ON_BLUR_KEY),
            keep_input: !off(KEEP_INPUT_KEY),
            monitor: if get(MONITOR_KEY).as_deref() == Some("main") {
                QuickMonitor::Main
            } else {
                QuickMonitor::Cursor
            },
        }
    }

    pub fn to_settings(self) -> [(&'static str, &'static str); 3] {
        let flag = |b: bool| if b { "1" } else { "0" };
        [
            (HIDE_ON_BLUR_KEY, flag(self.hide_on_blur)),
            (KEEP_INPUT_KEY, flag(self.keep_input)),
            (
                MONITOR_KEY,
                match self.monitor {
                    QuickMonitor::Cursor => "cursor",
                    QuickMonitor::Main => "main",
                },
            ),
        ]
    }
}

static OPTIONS: std::sync::RwLock<QuickOptions> = std::sync::RwLock::new(QuickOptions {
    hide_on_blur: true,
    keep_input: true,
    monitor: QuickMonitor::Cursor,
});

pub fn options() -> QuickOptions {
    *OPTIONS.read().unwrap_or_else(|e| e.into_inner())
}

pub fn set_options(options: QuickOptions) {
    *OPTIONS.write().unwrap_or_else(|e| e.into_inner()) = options;
}

/// 每次隐藏 / 唤出自增：过期的降内存计时器据此作废
static VISIBILITY_GEN: AtomicU64 = AtomicU64::new(0);
/// 预创建任务代数：关闭/销毁时递增，过期的延迟创建不得再建窗。
static PRECREATE_GEN: AtomicU64 = AtomicU64::new(0);
/// 非 MAX 表示窗口由该代数的预创建任务建出，且尚未被 show/collect/钉住认领。
static PRECREATE_OWNED_GEN: AtomicU64 = AtomicU64::new(u64::MAX);
const PRECREATE_NOT_OWNED: u64 = u64::MAX;

static LIFECYCLE_EPOCH: AtomicU64 = AtomicU64::new(0);
static EXECUTOR: std::sync::OnceLock<crate::quick_executor::Executor> = std::sync::OnceLock::new();

fn executor() -> &'static crate::quick_executor::Executor {
    EXECUTOR.get_or_init(crate::quick_executor::Executor::new)
}

pub(crate) fn on_lifecycle_worker() -> bool {
    executor().is_current()
}

pub(crate) fn defer_lifecycle(job: impl FnOnce() + Send + 'static) {
    if let Err(e) = executor().defer(job) {
        log::error!("[quick] {e}");
    }
}

pub(crate) fn call_lifecycle<T: Send + 'static>(
    job: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    if current_thread_is_ui() && !on_lifecycle_worker() {
        return Err("UI 不得等待快速窗生命周期任务".into());
    }
    executor().call(job)
}

thread_local! {
    // Only the lifecycle worker owns product state. UI completion sends a control message.
    static DESTROY_STATE: std::cell::Cell<DestroyState> = const { std::cell::Cell::new(DestroyState::Idle) };
}
static UI_THREAD: Mutex<Option<std::thread::ThreadId>> = Mutex::new(None);

fn destroy_state() -> DestroyState {
    DESTROY_STATE.get()
}

fn set_destroy_state(state: DestroyState) {
    DESTROY_STATE.set(state);
}

/// 在 UI 线程（setup / 全局窗口事件）记下事件循环所在线程，避免在其上等待 posted 任务。
pub fn note_ui_thread() {
    *UI_THREAD.lock().unwrap_or_else(|e| e.into_inner()) = Some(std::thread::current().id());
}

pub(crate) fn current_thread_is_ui() -> bool {
    match *UI_THREAD.lock().unwrap_or_else(|e| e.into_inner()) {
        Some(id) => id == std::thread::current().id(),
        // 尚未登记时按 UI 处理：宁可退让，也不在可能的 UI 线程上死等 posted 任务。
        None => true,
    }
}

#[cfg(test)]
fn clear_ui_thread_for_test() {
    *UI_THREAD.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Builder 全局 Destroyed 的完成通知（窗口对外暴露前已安装）。
pub fn notify_quick_destroyed() {
    let token = LIFECYCLE_EPOCH.load(Ordering::SeqCst);
    executor().resume(token, || set_destroy_state(DestroyState::Idle));
}

fn prepare_destroy() -> u64 {
    debug_assert!(on_lifecycle_worker());
    let token = LIFECYCLE_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    set_destroy_state(DestroyState::Queued);
    executor().pause(token);
    token
}

fn dispatch_destroy(app: &AppHandle, window: &WebviewWindow, token: u64) {
    // No application lock is held over any platform call or UI dispatch.
    if let Err(e) = window.destroy() {
        log::warn!("[quick] 销毁快速窗失败：{e}");
        set_destroy_state(DestroyState::DispatchFailed);
        executor().resume(token, || {});
        return;
    }
    // Global Destroyed normally resumes us. This ordered UI probe also recovers
    // a missing notification when the manager has already removed the old window.
    let handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        if quick_window(&handle).is_none() {
            executor().resume(token, || set_destroy_state(DestroyState::Idle));
        }
    }) {
        log::warn!("[quick] 无法核对销毁完成：{e}");
        set_destroy_state(DestroyState::DispatchFailed);
        executor().resume(token, || {});
    }
}

fn queue_quick_window_destroy(app: &AppHandle, window: &WebviewWindow) {
    let token = prepare_destroy();
    dispatch_destroy(app, window, token);
}

#[derive(Debug)]
enum EnsureError {
    PendingDestroy,
    DispatchFailed,
    Other(String),
}

impl std::fmt::Display for EnsureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PendingDestroy => {
                write!(f, "快速窗正在销毁，当前线程不能同步等待重建")
            }
            Self::DispatchFailed => {
                write!(f, "快速窗销毁消息未能入队，旧窗不可认领")
            }
            Self::Other(s) => write!(f, "{s}"),
        }
    }
}
/// 产品意图上窗口是否该显示。不信任 tao is_visible()：原生 ShowWindow 后标志可能反了，
/// 既会让暂停早退（亚克力留在查询上），也会让恢复把亚克力打到已隐藏的窗口（空闲 CPU）。
static INTENDED_VISIBLE: AtomicBool = AtomicBool::new(false);
/// 系统瞬态背景是否已经打开。隐藏时清掉；查询期间保持（合成器侧比 CSS 模糊便宜）。
static GLASS_APPLIED: AtomicBool = AtomicBool::new(false);
static QUERY_GLASS_GEN: AtomicU64 = AtomicU64::new(0);
/// 跟随主题的沉浸式深色（DWMWA_USE_IMMERSIVE_DARK_MODE）。由前端 set_glass_dark 告知。
static GLASS_DARK: AtomicBool = AtomicBool::new(false);
/// 当前是否处于低内存目标（唤出时只在确实降过时才恢复）
static LOW_MEMORY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickShown {
    /// 唤出请求时刻（Unix 毫秒）：热键回调或 quick_open 调用时
    pub t0_ms: u64,
    /// false：唤出时清空上次输入（选项「保留上次输入」关闭）
    pub keep_input: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 在显示器工作区内居中偏上（上方留 1/5）。纯函数，便于单测。
/// 入参均为物理像素；返回窗口左上角物理坐标。
pub fn placement(
    work_x: i32,
    work_y: i32,
    work_w: u32,
    work_h: u32,
    win_w: u32,
    win_h: u32,
) -> (i32, i32) {
    let x = work_x + (work_w.saturating_sub(win_w) / 2) as i32;
    let free = work_h.saturating_sub(win_h);
    let y = work_y + (free / 5) as i32;
    (x, y)
}

fn quick_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(QUICK_LABEL)
}

/// 收纳 / 唤出 / 钉住认领窗口：过期预创建不得再销毁已进入实际使用的窗。
pub(crate) fn claim_quick_window_for_live_use() {
    PRECREATE_OWNED_GEN.store(PRECREATE_NOT_OWNED, Ordering::SeqCst);
}

/// 预创建在登记之后复核代数：仅当仍由本轮预创建持有、且代数已过期时才丢弃。
pub(crate) fn should_discard_precreate(scheduled: u64, current: u64, owned_gen: u64) -> bool {
    current != scheduled && owned_gen == scheduled
}

/// 代数检查已通过后、登记窗口前再读一次代数。测试可在间隙插入屏障。
pub(crate) fn commit_precreate_after_check(
    scheduled: u64,
    gen: &std::sync::atomic::AtomicU64,
    live_claimed: bool,
    between_check_and_register: impl FnOnce(),
) -> bool {
    between_check_and_register();
    let current = gen.load(Ordering::SeqCst);
    let owned = if live_claimed {
        PRECREATE_NOT_OWNED
    } else {
        scheduled
    };
    !should_discard_precreate(scheduled, current, owned)
}

/// Creation/claiming runs only on the lifecycle worker, never inside a UI callback.
pub fn ensure_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if !on_lifecycle_worker() {
        let handle = app.clone();
        return call_lifecycle(move || ensure_window(&handle))?;
    }
    ensure_window_now(app).map_err(|e| e.to_string())
}

fn ensure_window_now(app: &AppHandle) -> Result<WebviewWindow, EnsureError> {
    debug_assert!(on_lifecycle_worker());
    let present = quick_window(app);
    let state = destroy_state();
    match ensure_action(present.is_some(), state) {
        EnsureAction::ClaimExisting => {
            claim_quick_window_for_live_use();
            Ok(present.expect("claimable window"))
        }
        EnsureAction::CreateFresh => {
            set_destroy_state(next_state_after_ensure(false, state));
            claim_quick_window_for_live_use();
            create_quick_window_owned(app).map_err(EnsureError::Other)
        }
        EnsureAction::YieldPendingDestroy => Err(EnsureError::PendingDestroy),
        EnsureAction::RejectDispatchFailed => Err(EnsureError::DispatchFailed),
    }
}

fn ensure_window_precreate(app: &AppHandle, scheduled: u64) -> Result<(), String> {
    if !on_lifecycle_worker() {
        let handle = app.clone();
        return call_lifecycle(move || ensure_window_precreate(&handle, scheduled))?;
    }
    let present = quick_window(app);
    match ensure_action(present.is_some(), destroy_state()) {
        EnsureAction::ClaimExisting => return Ok(()),
        EnsureAction::YieldPendingDestroy | EnsureAction::RejectDispatchFailed => {
            // 旧窗还在且不可认领：不在预创建线程上等待 Destroy。
            return Ok(());
        }
        EnsureAction::CreateFresh => {}
    }
    if PRECREATE_GEN.load(Ordering::SeqCst) != scheduled {
        return Ok(());
    }
    set_destroy_state(next_state_after_ensure(false, destroy_state()));
    let window = create_quick_window_owned(app)?;
    PRECREATE_OWNED_GEN.store(scheduled, Ordering::SeqCst);
    if should_discard_precreate(
        scheduled,
        PRECREATE_GEN.load(Ordering::SeqCst),
        PRECREATE_OWNED_GEN.load(Ordering::SeqCst),
    ) {
        PRECREATE_OWNED_GEN.store(PRECREATE_NOT_OWNED, Ordering::SeqCst);
        queue_quick_window_destroy(app, &window);
    }
    Ok(())
}

fn create_quick_window_owned(app: &AppHandle) -> Result<WebviewWindow, String> {
    debug_assert!(on_lifecycle_worker());
    let window_epoch = LIFECYCLE_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    let mut builder =
        WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("quick.html".into()))
            .title("TagLauncher 快速搜索")
            .inner_size(QUICK_WIDTH, QUICK_HEIGHT)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(true)
            .visible(false)
            .focused(false)
            .transparent(true)
            .background_color(tauri::window::Color(0, 0, 0, 0));
    // 不在创建时开系统背景：窗口默认 visible(false)，隐藏态持续合成会超空闲 CPU 预算。
    // 显示后再 apply_glass_effect，隐藏/销毁时清除。
    let window = builder
        .build()
        .map_err(|e| format!("创建快速搜索窗失败：{e}"))?;
    // 失焦自动隐藏（Esc / 打开对象 / 点到别处都应收起）
    let handle = app.clone();
    window.on_window_event(move |event| {
        if LIFECYCLE_EPOCH.load(Ordering::SeqCst) != window_epoch {
            return;
        }
        match event {
            tauri::WindowEvent::Focused(false) => {
                if crate::pin::surface() == crate::pin::Surface::Pin {
                    // 钉住表面：只有展开的抽屉失焦收回，浮动窗不动
                    crate::pin::on_blur(&handle);
                } else if options().hide_on_blur {
                    // 收纳会话进行中也按选项走：不自动隐藏时由 Esc / 处理完收起
                    hide_for_epoch(&handle, window_epoch);
                }
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                crate::pin::on_moved(&handle);
            }
            // Destroyed 完成通知走 lib.rs Builder 全局监听，不在 build 返回后异步加装。
            _ => {}
        }
    });
    crate::pin::install_caption_drag(&window);
    // 页面默认带 data-quick-hidden。此处不调用 clear_glass_effect：它的 with_webview
    // 与紧接着的首次 show/apply 竞态，可能把刚 SetIsVisible(true) 又打回 false。
    // 但仍须暂停默认可见的 controller：HWND 已 hidden，页面加载后否则可能在不可见
    // 窗口上以刷新率合成（两窗隐藏空闲门禁，约 180Hz）。回调内复核 INTENDED_VISIBLE，
    // 已发起的 show()/native_show 会再设回 true。
    pause_quick_controller_if_unintended(&window);
    Ok(window)
}

/// 窗口真正显示时才开 Win11 系统瞬态背景（DWMSBT_TRANSIENTWINDOW），并允许内容层亮 tint。
/// 创建或隐藏时关闭效果、把 WebView2 controller IsVisible 设为 false，并给页面打
/// `data-quick-hidden`。不用旧的 `Effect::Acrylic` / SetWindowCompositionAttribute（叠在白底
/// 主窗上是浑浊灰卡片）。build < 22621 或 API 失败时不挂系统背景，前端走干净实底。
/// 隐藏时关闭以免 DWM 在不可见窗口上继续合成（空闲 CPU）。
pub(crate) fn apply_glass_effect(window: &WebviewWindow) {
    if !INTENDED_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    let mut native = false;
    #[cfg(windows)]
    {
        if let Ok(h) = window.hwnd() {
            native = crate::dwm_backdrop::apply(h.0 as isize, GLASS_DARK.load(Ordering::SeqCst));
            if !native {
                // apply 失败路径已 clear；此处再清一次，覆盖未进入 apply 的残留。
                crate::dwm_backdrop::clear(h.0 as isize);
            }
        }
        set_controller_visible(window, true);
    }
    // 系统背景成功则打 data-acrylic，内容层用较透的明亮 tint，让合成器的亮度与噪点透出来。
    // 失败则揭开 data-quick-hidden，由 CSS 用接近不透明的干净实底回退，不再叠 CSS 模糊。
    let js = if native {
        "document.documentElement.setAttribute('data-acrylic','');document.documentElement.removeAttribute('data-quick-hidden');document.documentElement.removeAttribute('data-querying');"
    } else {
        "document.documentElement.removeAttribute('data-acrylic');document.documentElement.removeAttribute('data-quick-hidden');document.documentElement.removeAttribute('data-querying');"
    };
    let _ = window.eval(js);
    GLASS_APPLIED.store(true, Ordering::SeqCst);
}

pub(crate) fn clear_glass_effect(window: &WebviewWindow) {
    GLASS_APPLIED.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    {
        if let Ok(h) = window.hwnd() {
            crate::dwm_backdrop::clear(h.0 as isize);
        }
        set_controller_visible(window, false);
    }
    let _ = window.eval(
        "document.documentElement.removeAttribute('data-acrylic');document.documentElement.removeAttribute('data-querying');document.documentElement.setAttribute('data-quick-hidden','');",
    );
}

/// 唤出先让输入框可聚焦并记下 summon 指标；系统背景在空闲后再开（输入优先，与查询恢复同一 180ms）。
const GLASS_AFTER_SHOW: Duration = Duration::from_millis(180);

fn schedule_glass(window: &WebviewWindow) {
    let gen = VISIBILITY_GEN.load(Ordering::SeqCst);
    let window = window.clone();
    let _ = std::thread::Builder::new()
        .name("tl-quick-glass".into())
        .spawn(move || {
            std::thread::sleep(GLASS_AFTER_SHOW);
            if VISIBILITY_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            if INTENDED_VISIBLE.load(Ordering::SeqCst) {
                apply_glass_effect(&window);
            }
        });
}

pub(crate) fn set_intended_visible(visible: bool) {
    INTENDED_VISIBLE.store(visible, Ordering::SeqCst);
    if !visible {
        VISIBILITY_GEN.fetch_add(1, Ordering::SeqCst);
        QUERY_GLASS_GEN.fetch_add(1, Ordering::SeqCst);
    }
}

/// 查询期间不再拆掉系统背景：合成器侧瞬态亚克力比 CSS `backdrop-filter` 便宜，来回开关反而贵。
/// 保留函数与 `ResumeGlassAfterQuery`，调用点不用改；本体是空操作。
pub(crate) fn suspend_glass_for_query(_app: &AppHandle) {}

pub(crate) fn schedule_resume_glass_after_query(_app: &AppHandle) {}

/// `quick_search` 结束（含失败）时安排恢复镜面（现为不再需要恢复的占位）。
pub(crate) struct ResumeGlassAfterQuery<'a>(pub &'a AppHandle);
impl Drop for ResumeGlassAfterQuery<'_> {
    fn drop(&mut self) {
        schedule_resume_glass_after_query(self.0);
    }
}

/// 前端告知当前主题是否深色，系统背景跟随 `DWMWA_USE_IMMERSIVE_DARK_MODE`。
#[tauri::command]
pub fn set_glass_dark(app: AppHandle, dark: bool) {
    GLASS_DARK.store(dark, Ordering::SeqCst);
    if !INTENDED_VISIBLE.load(Ordering::SeqCst) || !GLASS_APPLIED.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = quick_window(&app) else {
        return;
    };
    #[cfg(windows)]
    if let Ok(h) = window.hwnd() {
        crate::dwm_backdrop::set_dark(h.0 as isize, dark);
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// WebView2 的 HWND 隐藏后，controller 不一定跟着停绘（透明窗尤其如此）。
/// 主窗收到托盘时也用它：Tauri 的 hide 只隐藏 HWND，不告诉 WebView2。
pub(crate) fn set_controller_visible(window: &WebviewWindow, visible: bool) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(move |webview| {
            // SAFETY：with_webview 回调在 runtime 主线程（即 Windows UI/WebView2 线程）执行，
            // controller 在回调期间有效。wry 2.12：调用方已在主线程则同步跑完；否则
            // send_event FIFO 排队。不再加非可重入锁：主线程上 with_webview 同步重入
            // （例如 SetIsVisible 派发 Focused 再进 set_controller_visible）会自锁。
            let result = unsafe { webview.controller().SetIsVisible(visible.into()) };
            if let Err(e) = result {
                log::warn!("[quick] SetIsVisible({visible}) 失败：{e}");
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (window, visible);
}

/// 预创建或尚未 intended 显示时暂停 controller。须在 WebView/UI 线程上按
/// `INTENDED_VISIBLE` 的最终状态决定：若 show() 已把意图设为可见，则不要保持 false
/// （排队中的 SetIsVisible(true) 仍会再跑一次，此处恢复是为了不让中间态把页面留空）。
fn pause_quick_controller_if_unintended(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(move |webview| {
            if INTENDED_VISIBLE.load(Ordering::SeqCst) {
                return;
            }
            // SAFETY：同 set_controller_visible
            let result = unsafe { webview.controller().SetIsVisible(false.into()) };
            if let Err(e) = result {
                log::warn!("[quick] SetIsVisible(false) 失败：{e}");
            }
            if INTENDED_VISIBLE.load(Ordering::SeqCst) {
                let result = unsafe { webview.controller().SetIsVisible(true.into()) };
                if let Err(e) = result {
                    log::warn!("[quick] SetIsVisible(true) 失败：{e}");
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}

pub fn destroy_window(app: &AppHandle) {
    VISIBILITY_GEN.fetch_add(1, Ordering::SeqCst);
    PRECREATE_GEN.fetch_add(1, Ordering::SeqCst);
    let handle = app.clone();
    defer_lifecycle(move || destroy_window_owned(&handle, false));
}

/// Old collect cleanup commits only while CollectState is still empty. Publishing
/// Queued under that short lock separates a new merge into before/after the commit.
pub(crate) fn cleanup_collect_window(app: &AppHandle) {
    let handle = app.clone();
    defer_lifecycle(move || destroy_window_owned(&handle, true));
}

fn destroy_window_owned(app: &AppHandle, collect_cleanup: bool) {
    debug_assert!(on_lifecycle_worker());
    let Some(window) = quick_window(app) else {
        return;
    };
    let token = if collect_cleanup {
        let state = app.state::<crate::collect::CollectState>();
        let Some(token) = crate::collect::commit_idle_cleanup(&state, || {
            if crate::desktop::quick_window_needed(app) {
                None
            } else {
                Some(prepare_destroy())
            }
        })
        .flatten() else {
            return;
        };
        token
    } else {
        prepare_destroy()
    };
    PRECREATE_OWNED_GEN.store(PRECREATE_NOT_OWNED, Ordering::SeqCst);
    set_intended_visible(false);
    #[cfg(windows)]
    if let Ok(h) = window.hwnd() {
        crate::dwm_backdrop::clear(h.0 as isize);
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
            ShowWindow(h.0 as _, SW_HIDE);
        }
    }
    let _ = window.hide();
    dispatch_destroy(app, &window, token);
}

/// 功能开启时延迟预创建（后台线程，不阻塞启动）；关闭时销毁。
pub fn sync_window(app: &AppHandle, enabled: bool) {
    if !enabled {
        PRECREATE_GEN.fetch_add(1, Ordering::SeqCst);
        destroy_window(app);
        return;
    }
    if quick_window(app).is_some() {
        return;
    }
    let scheduled = PRECREATE_GEN.load(Ordering::SeqCst);
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-quick-precreate".into())
        .spawn(move || {
            run_scheduled_precreate(scheduled, &PRECREATE_GEN, wait_precreate_delay, || {
                if let Err(e) = ensure_window_precreate(&app, scheduled) {
                    log::warn!("[quick] {e}");
                }
            });
        });
}

fn wait_precreate_delay() {
    #[cfg(test)]
    if let Some(hook) = TEST_PRECREATE_DELAY.with(|h| h.get()) {
        hook();
        return;
    }
    std::thread::sleep(PRECREATE_DELAY);
}

/// 延迟结束后若代数已变（关闭或新一轮 sync），不再创建窗口。
fn run_scheduled_precreate(
    scheduled: u64,
    gen: &std::sync::atomic::AtomicU64,
    delay: impl FnOnce(),
    create: impl FnOnce(),
) {
    delay();
    if gen.load(Ordering::SeqCst) != scheduled {
        return;
    }
    create();
}

#[cfg(test)]
thread_local! {
    static TEST_PRECREATE_DELAY: std::cell::Cell<Option<fn()>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn with_precreate_delay<F, R>(hook: fn(), f: F) -> R
where
    F: FnOnce() -> R,
{
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            TEST_PRECREATE_DELAY.with(|h| h.set(None));
        }
    }
    TEST_PRECREATE_DELAY.with(|h| h.set(Some(hook)));
    let _g = Guard;
    f()
}

/// 把快速窗放到选项指定的显示器（鼠标所在 / 主窗所在；取不到则退到另一个）的工作区。
fn place_on_target_monitor(app: &AppHandle, window: &WebviewWindow) {
    let main_monitor = || {
        app.get_webview_window("main")
            .and_then(|m| m.current_monitor().ok().flatten())
    };
    let cursor_monitor = || {
        app.cursor_position()
            .ok()
            .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
    };
    let monitor = match options().monitor {
        QuickMonitor::Cursor => cursor_monitor().or_else(main_monitor),
        QuickMonitor::Main => main_monitor().or_else(cursor_monitor),
    }
    .or_else(|| window.current_monitor().ok().flatten())
    .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = monitor else {
        let _ = window.center();
        return;
    };
    let scale = m.scale_factor();
    let (w, h) = ((QUICK_WIDTH * scale) as u32, (QUICK_HEIGHT * scale) as u32);
    let area = m.work_area();
    let (x, y) = placement(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        w,
        h,
    );
    let _ = window.set_size(tauri::PhysicalSize::new(w, h));
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// 唤出快速窗。`activate` 为 false 时不抢前台（仅 E2E 用：测试机守护不允许应用抢前台），
/// 产品路径（热键/托盘/主窗按钮）一律 true。
pub fn show(app: &AppHandle, t0_ms: u64, activate: bool) -> Result<(), String> {
    if !on_lifecycle_worker() {
        let handle = app.clone();
        return call_lifecycle(move || show(&handle, t0_ms, activate))?;
    }
    let window = ensure_window(app)?;
    // 钉住视图共用本窗口：先切回搜索表面（尺寸 / 置顶 / 前端表面）
    crate::pin::enter_search(&window);
    VISIBILITY_GEN.fetch_add(1, Ordering::SeqCst);
    set_intended_visible(true);
    if LOW_MEMORY.load(Ordering::SeqCst) {
        set_memory_level(&window, false);
    }
    place_on_target_monitor(app, &window);
    window.show().map_err(|e| e.to_string())?;
    // 钉住表面用原生 ShowWindow 显隐，tao 的可见标志可能停在「可见」而窗口其实已隐藏 → 上面的 show 是空操作；补一次原生显示
    native_show(&window, activate);
    // 快速窗可见期间按可见间隔检测外部写入，唤出时先检测一次
    crate::data_sync::poke();
    if activate {
        let _ = window.set_focus();
    }
    let _ = window.emit(
        QUICK_SHOWN_EVENT,
        QuickShown {
            t0_ms,
            keep_input: options().keep_input,
        },
    );
    // 先完成唤出（输入可聚焦），再开系统背景，避免计入 summon p95。
    schedule_glass(&window);
    Ok(())
}

fn native_show(window: &tauri::WebviewWindow, activate: bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOW, SW_SHOWNOACTIVATE};
        if let Ok(h) = window.hwnd() {
            // SAFETY：hwnd 来自本进程窗口
            unsafe {
                ShowWindow(h.0 as _, if activate { SW_SHOW } else { SW_SHOWNOACTIVATE });
            }
        }
        // 立刻恢复绘制（隐藏时 SetIsVisible(false)）；毛玻璃由 schedule_glass 延后开启。
        set_controller_visible(window, true);
    }
    #[cfg(not(windows))]
    let _ = (window, activate);
}

/// 同 [`native_show`]：tao 标志可能停在「隐藏」（钉住表面原生显示过），tauri hide 会跳过
fn native_hide(window: &tauri::WebviewWindow) {
    set_intended_visible(false);
    clear_glass_effect(window);
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        if let Ok(h) = window.hwnd() {
            // SAFETY：hwnd 来自本进程窗口
            unsafe {
                ShowWindow(h.0 as _, SW_HIDE);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

fn hide_for_epoch(app: &AppHandle, epoch: u64) {
    let handle = app.clone();
    if let Err(e) = executor().defer_guarded(
        move || LIFECYCLE_EPOCH.load(Ordering::SeqCst) == epoch,
        move || hide(&handle),
    ) {
        log::error!("[quick] {e}");
    }
}

pub fn hide(app: &AppHandle) {
    if !on_lifecycle_worker() {
        hide_for_epoch(app, LIFECYCLE_EPOCH.load(Ordering::SeqCst));
        return;
    }
    // 失焦 / CloseRequested / 同步 quick_hide 都可能在 UI 线程。销毁中不得走进 restore → ensure。
    if !ui_hide_may_enter_ensure(destroy_state()) {
        return;
    }
    // 钉住视图开启：搜索收起 = 还原为钉住视图（同一个 WebView），不隐藏窗口
    if crate::pin::active() {
        if crate::pin::surface() == crate::pin::Surface::Search {
            if let Err(e) = crate::pin::restore(app) {
                log::warn!("[quick] 还原钉住视图失败：{e}");
            }
        }
        return;
    }
    if let Some(w) = quick_window(app) {
        let _ = w.hide();
        native_hide(&w);
        after_hidden(app);
    }
}

/// 隐藏超过 LOW_MEMORY_AFTER 仍未唤出 → 降为低内存目标。debug 构建可用
/// TAGLAUNCHER_E2E_QUICK_LOW_MS 缩短（E2E 用）。
fn after_hidden(app: &AppHandle) {
    let gen = VISIBILITY_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let delay = low_memory_after();
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-quick-lowmem".into())
        .spawn(move || {
            std::thread::sleep(delay);
            if VISIBILITY_GEN.load(Ordering::SeqCst) != gen {
                return; // 期间唤出或再次隐藏过，由新的计时负责
            }
            if let Some(w) = quick_window(&app) {
                if !w.is_visible().unwrap_or(true) {
                    set_memory_level(&w, true);
                }
            }
        });
}

fn low_memory_after() -> Duration {
    if cfg!(debug_assertions) {
        if let Some(ms) = std::env::var("TAGLAUNCHER_E2E_QUICK_LOW_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
        {
            return Duration::from_millis(ms);
        }
    }
    LOW_MEMORY_AFTER
}

/// 设置快速窗 WebView2 的内存目标（ICoreWebView2_19，WebView2 Runtime ≥ 114）。
/// 运行时太旧拿不到接口时只记日志，不影响功能。成功后给快速窗发事件（E2E 据此断言）。
fn set_memory_level(window: &WebviewWindow, low: bool) {
    #[cfg(windows)]
    {
        let target = window.clone();
        let _ = window.with_webview(move |webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows::core::Interface;
            let level = if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };
            // SAFETY：with_webview 回调在 WebView 所在线程执行，controller 在回调期间有效
            let result = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_19>())
                    .and_then(|core| core.SetMemoryUsageTargetLevel(level))
            };
            match result {
                Ok(()) => {
                    LOW_MEMORY.store(low, Ordering::SeqCst);
                    let _ = target.emit(
                        QUICK_MEMORY_EVENT,
                        serde_json::json!({ "level": if low { "low" } else { "normal" }, "atMs": now_ms() }),
                    );
                }
                Err(e) => log::warn!("[quick] 设置 WebView2 内存目标失败：{e}"),
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (window, low);
}

/// 热键：可见且有焦点 → 收起；否则唤出。
pub fn toggle(app: &AppHandle, t0_ms: u64) {
    if let Some(w) = quick_window(app) {
        if w.is_visible().unwrap_or(false)
            && w.is_focused().unwrap_or(false)
            && crate::pin::surface() == crate::pin::Surface::Search
        {
            hide(app);
            return;
        }
    }
    // 窗口创建要离开主线程（热键回调在主线程）
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = show(&app, t0_ms, true) {
            log::warn!("[quick] {e}");
        }
    });
}

// ───────────────────────────── 命令 ─────────────────────────────

/// 打开快速搜索（托盘菜单、主窗入口、E2E 共用唤出入口）。async：可能需要创建窗口。
#[tauri::command]
pub async fn quick_open(
    app: AppHandle,
    t0_ms: Option<u64>,
    activate: Option<bool>,
) -> Result<(), String> {
    show(&app, t0_ms.unwrap_or_else(now_ms), activate.unwrap_or(true))
}

#[tauri::command]
pub fn quick_hide(app: AppHandle) {
    hide(&app);
}

/// 在主窗中定位对象：显示主窗并通知它选中、滚动到该对象。
#[tauri::command]
pub fn quick_locate_in_main(app: AppHandle, id: i64) {
    hide(&app);
    crate::desktop::show_main_window(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit(QUICK_LOCATE_EVENT, serde_json::json!({ "id": id }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::item_service;
    use crate::Database;

    #[test]
    fn placement_centers_horizontally_and_sits_in_upper_fifth() {
        assert_eq!(placement(0, 0, 1920, 1040, 680, 440), (620, 120));
        // 副屏在左侧负坐标
        assert_eq!(
            placement(-1920, 0, 1920, 1080, 680, 440),
            (-1920 + 620, 128)
        );
        // 窗口比工作区还大：贴左上，不出现负偏移
        assert_eq!(placement(100, 50, 600, 300, 680, 440), (100, 50));
    }

    #[test]
    fn readonly_items_match_write_connection_items() {
        let path = std::env::temp_dir().join(format!("tl_quick_ro_{}.db", std::process::id()));
        let p = path.to_string_lossy().to_string();
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
        let db = Database::new(&path).unwrap();
        db.get_conn()
            .execute(
                "INSERT INTO items (name, path, type) VALUES ('a.exe', 'D:\\a.exe', 'exe')",
                [],
            )
            .unwrap();
        let via_write = item_service::get_items(&db.get_conn()).unwrap();
        let via_read = item_service::get_items(db.read_conn().unwrap().conn()).unwrap();
        assert_eq!(
            via_write.iter().map(|i| i.item.id).collect::<Vec<_>>(),
            via_read.iter().map(|i| i.item.id).collect::<Vec<_>>()
        );
        drop(db);
        for f in [p.clone(), format!("{p}-wal"), format!("{p}-shm")] {
            let _ = std::fs::remove_file(&f);
        }
    }

    #[test]
    fn expired_precreate_does_not_create_after_cancel() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::sync::{Arc, Barrier};
        use std::time::Duration;

        let gen = Arc::new(AtomicU64::new(7));
        let created = Arc::new(AtomicBool::new(false));
        let start = Arc::new(Barrier::new(2));
        let finish = Arc::new(Barrier::new(2));
        let created_flag = created.clone();
        let start_d = start.clone();
        let finish_d = finish.clone();
        let gen_job = gen.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let job = std::thread::spawn(move || {
            run_scheduled_precreate(
                7,
                &gen_job,
                || {
                    start_d.wait();
                    finish_d.wait();
                },
                || created_flag.store(true, Ordering::SeqCst),
            );
            let _ = tx.send(created_flag.load(Ordering::SeqCst));
        });
        start.wait();
        gen.fetch_add(1, Ordering::SeqCst); // 关闭 / 新一轮 sync
        finish.wait();
        let created_after = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("预创建任务未结束");
        assert!(!created_after, "过期预创建不得再建窗");
        job.join().unwrap();
        assert!(!created.load(Ordering::SeqCst));
    }

    #[test]
    fn current_precreate_still_runs_and_does_not_drop_a_live_generation() {
        use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
        let gen = AtomicU64::new(3);
        let created = AtomicUsize::new(0);
        run_scheduled_precreate(
            3,
            &gen,
            || {},
            || {
                created.fetch_add(1, Ordering::SeqCst);
            },
        );
        assert_eq!(created.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn precreate_commit_barrier_discards_after_check_before_register() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::sync::{Arc, Barrier};
        use std::time::Duration;

        let gen = Arc::new(AtomicU64::new(4));
        let start = Arc::new(Barrier::new(2));
        let finish = Arc::new(Barrier::new(2));
        let start_d = start.clone();
        let finish_d = finish.clone();
        let gen_job = gen.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let job = std::thread::spawn(move || {
            let keep = commit_precreate_after_check(4, &gen_job, false, || {
                start_d.wait();
                finish_d.wait();
            });
            let _ = tx.send(keep);
        });
        start.wait();
        gen.fetch_add(1, Ordering::SeqCst);
        finish.wait();
        let keep = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("commit barrier");
        assert!(!keep, "检查通过后、登记前关闭必须丢弃预创建窗");
        job.join().unwrap();
        assert!(should_discard_precreate(4, 5, 4));
        assert!(
            !should_discard_precreate(4, 5, u64::MAX),
            "已被实际使用认领的窗不得销毁"
        );
        assert!(!should_discard_precreate(4, 4, 4));
    }

    #[test]
    fn precreate_commit_barrier_keeps_window_already_claimed() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::{Arc, Barrier};
        use std::time::Duration;

        let gen = Arc::new(AtomicU64::new(9));
        let start = Arc::new(Barrier::new(2));
        let finish = Arc::new(Barrier::new(2));
        let start_d = start.clone();
        let finish_d = finish.clone();
        let gen_job = gen.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let job = std::thread::spawn(move || {
            let keep = commit_precreate_after_check(9, &gen_job, true, || {
                start_d.wait();
                finish_d.wait();
            });
            let _ = tx.send(keep);
        });
        start.wait();
        gen.fetch_add(1, Ordering::SeqCst);
        finish.wait();
        let keep = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("claimed commit");
        assert!(keep, "收纳/唤出已认领的窗口不得因过期预创建被销毁");
        job.join().unwrap();
    }

    #[test]
    fn ui_hide_does_not_enter_ensure_while_destroy_queued() {
        // 产品 hide 入口与决策函数一致：销毁中退让，避免 restore → ensure。
        set_destroy_state(DestroyState::Idle);
        assert!(ui_hide_may_enter_ensure(destroy_state()));
        set_destroy_state(DestroyState::Queued);
        assert!(!ui_hide_may_enter_ensure(destroy_state()));
        set_destroy_state(DestroyState::Idle);
        notify_quick_destroyed();
        assert!(ui_hide_may_enter_ensure(destroy_state()));
        set_destroy_state(DestroyState::DispatchFailed);
        assert!(!ui_hide_may_enter_ensure(destroy_state()));
        set_destroy_state(DestroyState::Idle);
    }

    #[test]
    fn unknown_or_ui_thread_must_not_block_for_posted_ensure() {
        assert!(current_thread_is_ui(), "未登记时按 UI 处理，禁止等待");
        assert!(!may_block_for_ui_progress(current_thread_is_ui()));
        note_ui_thread();
        assert!(current_thread_is_ui());
        let noted = std::thread::current().id();
        let worker = std::thread::spawn(move || {
            // 登记发生在「UI」线程后，工作线程不得被当成 UI。
            let _ = noted;
            !current_thread_is_ui() && may_block_for_ui_progress(current_thread_is_ui())
        })
        .join()
        .expect("worker");
        assert!(worker, "工作线程才允许把 ensure 排到下一轮 UI");
        clear_ui_thread_for_test();
    }
}

#[cfg(test)]
mod option_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn options_default_to_previous_behaviour_and_round_trip() {
        let none = QuickOptions::from_settings(|_| None);
        assert_eq!(none, QuickOptions::default());
        let custom = QuickOptions {
            hide_on_blur: false,
            keep_input: false,
            monitor: QuickMonitor::Main,
        };
        let stored: HashMap<&str, &str> = custom.to_settings().into_iter().collect();
        let back = QuickOptions::from_settings(|k| stored.get(k).map(|v| v.to_string()));
        assert_eq!(back, custom);
        // 未知值按默认
        let odd = QuickOptions::from_settings(|k| (k == MONITOR_KEY).then(|| "left".to_string()));
        assert_eq!(odd.monitor, QuickMonitor::Cursor);
    }
}

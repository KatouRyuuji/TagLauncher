//! 全局快速搜索窗（全局极速阶段②）。
//!
//! - 功能开关 = 「打开快速搜索」动作绑定了全局快捷键（默认不绑）。开启时在主窗首帧之后
//!   预创建隐藏的 `quick` 窗口并复用；关闭（清除快捷键）时销毁，不占资源。
//! - 唤出：定位到鼠标所在显示器的工作区（居中偏上）→ show → focus → 给快速窗发
//!   `quick-shown { t0Ms }`（t0 = 热键回调时刻，供前端度量「唤出到可输入」）。
//! - 数据：快速窗不加载全量对象，每次输入调 `quick_search`（与主窗同一个 Rust 内存索引，
//!   见 services::search_index）只取前 50 条；写操作（打标签）调用与主窗相同的命令，
//!   写后发 `window-data-written` 让主窗按 ID 增量刷新。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
/// 产品意图上窗口是否该显示。不信任 tao is_visible()：原生 ShowWindow 后标志可能反了，
/// 既会让暂停早退（亚克力留在查询上），也会让恢复把亚克力打到已隐藏的窗口（空闲 CPU）。
static INTENDED_VISIBLE: AtomicBool = AtomicBool::new(false);
/// 亚克力/镜面是否已经 apply 过、还没 clear/suspend。查询热路径只在为 true 时才走 DWM。
static GLASS_APPLIED: AtomicBool = AtomicBool::new(false);
static QUERY_GLASS_GEN: AtomicU64 = AtomicU64::new(0);
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

/// 创建隐藏的快速窗（已存在则直接返回）。不要在主线程同步命令里调用（Windows 上会死锁）。
pub fn ensure_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    // 串行化创建：窗口要等主线程建完才登记标签，多个线程（收纳会话的多次弹出、预创建）
    // 同时看到「不存在」会各建一个同名窗口（D-SHELL-04 实测出现两个 quick.html）
    static CREATE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = CREATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(w) = quick_window(app) {
        return Ok(w);
    }
    let mut builder = WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("quick.html".into()))
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
    // 不在创建时挂亚克力：窗口默认 visible(false)，EffectState::Active 会让 DWM 在隐藏态持续合成，
    // 空闲 CPU 超 1% 预算。显示时再 apply_glass_effect，隐藏/销毁时清除。
    let window = builder
        .build()
        .map_err(|e| format!("创建快速搜索窗失败：{e}"))?;
    // 失焦自动隐藏（Esc / 打开对象 / 点到别处都应收起）
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(false) => {
            if crate::pin::surface() == crate::pin::Surface::Pin {
                // 钉住表面：只有展开的抽屉失焦收回，浮动窗不动
                crate::pin::on_blur(&handle);
            } else if options().hide_on_blur {
                // 收纳会话进行中也按选项走：不自动隐藏时由 Esc / 处理完收起
                hide(&handle);
            }
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            crate::pin::on_moved(&handle);
        }
        _ => {}
    });
    // 页面默认带 data-quick-hidden。此处不调用 clear_glass_effect：它的 with_webview
    // 与紧接着的首次 show/apply 竞态，可能把刚 SetIsVisible(true) 又打回 false。
    Ok(window)
}

/// 窗口真正显示时才开系统亚克力（不是 Mica）并允许 CSS 毛玻璃。
/// 创建或隐藏时关闭效果、把 WebView2 controller IsVisible 设为 false，并给页面打
/// `data-quick-hidden`（关掉 backdrop-filter）：透明窗 + 毛玻璃在 HWND 已隐藏时仍会让
/// GPU 合成桌面背景，空闲 CPU 超 1% 预算。不用 TrySuspend（恢复有延迟，和极速唤出冲突）。
/// API / 系统不支持时忽略。
pub(crate) fn apply_glass_effect(window: &WebviewWindow) {
    if !INTENDED_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    let mut acrylic = false;
    #[cfg(windows)]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        acrylic = window
            .set_effects(
                EffectsBuilder::new()
                    .effect(Effect::Acrylic)
                    .state(EffectState::Active)
                    .build(),
            )
            .is_ok();
        set_controller_visible(window, true);
    }
    // 亚克力成功则打 data-acrylic，前端不再叠整窗 backdrop-filter（避免双模糊拖慢查询）。
    // 失败则只揭开 data-quick-hidden，由 CSS 顶栏窄带滤镜回退。
    let js = if acrylic {
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
        let _ = window.set_effects(None);
        set_controller_visible(window, false);
    }
    let _ = window.eval(
        "document.documentElement.removeAttribute('data-acrylic');document.documentElement.removeAttribute('data-querying');document.documentElement.setAttribute('data-quick-hidden','');",
    );
}

/// 唤出先让输入框可聚焦并记下 summon 指标；镜面在空闲后再开，避免计入 summon p95，
/// 也避免 50ms 到点与首字查询在 DWM 上打架。与查询结束后恢复同一时间窗（180ms）。
const GLASS_AFTER_SHOW: Duration = Duration::from_millis(180);

fn schedule_glass(window: &WebviewWindow) {
    let gen = VISIBILITY_GEN.load(Ordering::SeqCst);
    let qgen = QUERY_GLASS_GEN.load(Ordering::SeqCst);
    let window = window.clone();
    let _ = std::thread::Builder::new()
        .name("tl-quick-glass".into())
        .spawn(move || {
            std::thread::sleep(GLASS_AFTER_SHOW);
            if VISIBILITY_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            if QUERY_GLASS_GEN.load(Ordering::SeqCst) != qgen {
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

/// 查询期间暂停整窗亚克力。同 runner 对照（43211890354）：PR66 5k p95 29.6（余量 0.4ms），
/// 19bc707 开毛玻璃 32.9，关掉 28.8。代价是亚克力/滤镜，不是搜索本身。controller 保持可见；
/// 查询空闲后再恢复镜面。打 `data-querying` 同时关掉 CSS 顶栏滤镜回退。
const RESUME_GLASS_AFTER_QUERY: Duration = Duration::from_millis(180);

pub(crate) fn suspend_glass_for_query(app: &AppHandle) {
    // 先作废待执行的开玻璃任务（纯原子，不进 DWM）。
    QUERY_GLASS_GEN.fetch_add(1, Ordering::SeqCst);
    VISIBILITY_GEN.fetch_add(1, Ordering::SeqCst);
    // 只在镜面已经打开时才 set_effects(None)+eval。b894aa5 每次查询都走 DWM，
    // 这笔开销计入「输入到出结果」：正式/debug 5k p95 到了 34 / 33.9。
    // 性能测试在 180ms 空闲窗内连续输入，玻璃从未打开，这条不会进。
    if !GLASS_APPLIED.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = quick_window(app) else { return };
    GLASS_APPLIED.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    {
        let _ = window.set_effects(None);
    }
    let _ = window.eval(
        "document.documentElement.removeAttribute('data-acrylic');document.documentElement.setAttribute('data-querying','');",
    );
}

pub(crate) fn schedule_resume_glass_after_query(app: &AppHandle) {
    let Some(window) = quick_window(app) else { return };
    if !INTENDED_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    let qgen = QUERY_GLASS_GEN.load(Ordering::SeqCst);
    let vis = VISIBILITY_GEN.load(Ordering::SeqCst);
    let window = window.clone();
    let _ = std::thread::Builder::new()
        .name("tl-query-glass".into())
        .spawn(move || {
            std::thread::sleep(RESUME_GLASS_AFTER_QUERY);
            if QUERY_GLASS_GEN.load(Ordering::SeqCst) != qgen {
                return;
            }
            if VISIBILITY_GEN.load(Ordering::SeqCst) != vis {
                return; // 已隐藏、销毁或又一次查询
            }
            if INTENDED_VISIBLE.load(Ordering::SeqCst) {
                apply_glass_effect(&window);
            }
        });
}

/// `quick_search` 结束（含失败）时安排恢复镜面。
pub(crate) struct ResumeGlassAfterQuery<'a>(pub &'a AppHandle);
impl Drop for ResumeGlassAfterQuery<'_> {
    fn drop(&mut self) {
        schedule_resume_glass_after_query(self.0);
    }
}

/// WebView2 的 HWND 隐藏后，controller 不一定跟着停绘（透明窗尤其如此）。
fn set_controller_visible(window: &WebviewWindow, visible: bool) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(move |webview| {
            // SAFETY：with_webview 回调在 WebView 所在线程，controller 在回调期间有效
            let result = unsafe { webview.controller().SetIsVisible(visible.into()) };
            if let Err(e) = result {
                log::warn!("[quick] SetIsVisible({visible}) 失败：{e}");
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (window, visible);
}

pub fn destroy_window(app: &AppHandle) {
    // 作废延后开玻璃的任务，避免 50ms 后 apply_glass 与 destroy 抢同一窗口。
    VISIBILITY_GEN.fetch_add(1, Ordering::SeqCst);
    set_intended_visible(false);
    if let Some(w) = quick_window(app) {
        // 只做同步清理：set_effects / clear_glass 的 with_webview 都可能与 destroy
        // 抢同一窗口（E-PIN-01：关闭钉住且未开搜索时应销毁；96e47da e2e(3) 再现）。
        #[cfg(windows)]
        {
            if let Ok(h) = w.hwnd() {
                use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                // SAFETY：hwnd 来自本进程窗口
                unsafe {
                    ShowWindow(h.0 as _, SW_HIDE);
                }
            }
        }
        let _ = w.hide();
        if let Err(e) = w.destroy() {
            log::warn!("[quick] 销毁快速窗失败：{e}，改用 close");
            let _ = w.close();
        }
    }
}

/// 功能开启时延迟预创建（后台线程，不阻塞启动）；关闭时销毁。
pub fn sync_window(app: &AppHandle, enabled: bool) {
    if !enabled {
        destroy_window(app);
        return;
    }
    if quick_window(app).is_some() {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-quick-precreate".into())
        .spawn(move || {
            std::thread::sleep(PRECREATE_DELAY);
            if let Err(e) = ensure_window(&app) {
                log::warn!("[quick] {e}");
            }
        });
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
    // 先完成唤出（输入可聚焦），再开亚克力 / 毛玻璃，避免计入 summon p95。
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

pub fn hide(app: &AppHandle) {
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

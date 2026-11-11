//! 钉住视图 / 边缘抽屉（设计见 PROJECT_MANUAL「钉住视图」）。
//!
//! - 复用快速窗 WebView：钉住视图是 `quick` 窗口的另一个表面（surface）。唤出快速搜索时切到
//!   search；搜索收起时若钉住视图开启则还原为 pin，否则照旧隐藏。开启钉住视图不新增 WebView2。
//! - 边缘抽屉：收起 = 窗口缩成贴边的细条（把手，置顶）。WebView 自己收到鼠标进入后调用
//!   `pin_expand`，不轮询鼠标、不装输入钩子；离开 / 失焦后 `pin_collapse`。
//! - 前台全屏：抽屉模式下用 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`（前台切换事件，
//!   非输入钩子）在前台变化时判断；前台全屏且与抽屉同一显示器 → 隐藏把手。展开前再判一次。
//! - 位置记忆：抽屉 = 显示器名 + 边 + 上下比例（拖动展开的抽屉，松手 = 本进程 EVENT_SYSTEM_MOVESIZEEND
//!   时吸附到最近显示器的左 / 右边）；浮动窗 = 物理左上角 + 逻辑宽高（移动 / 改尺寸静默后保存）。

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::services::settings_service;
use crate::Database;

pub const PIN_SURFACE_EVENT: &str = "pin-surface";
/// 面板最多列出的对象数（其余提示去主窗查看）
pub const PIN_ITEMS_LIMIT: usize = 500;
/// 抽屉面板逻辑宽度、把手逻辑宽度
pub const DRAWER_WIDTH: f64 = 320.0;
pub const HANDLE_WIDTH: f64 = 4.0;
/// 抽屉面板高度：工作区的 70%，不超过 640 逻辑像素
const DRAWER_HEIGHT_FRACTION: f64 = 0.7;
const DRAWER_MAX_HEIGHT: f64 = 640.0;
/// 浮动窗默认逻辑尺寸
const FLOAT_DEFAULT: (f64, f64) = (340.0, 480.0);
const FLOAT_MIN: (f64, f64) = (240.0, 200.0);
/// 滑出 / 收回动画：步数与每步间隔
const ANIM_STEPS: u32 = 6;
const ANIM_STEP: Duration = Duration::from_millis(14);
/// 拖动结束判定：最后一次 Moved 之后静默这么久
const DRAG_SETTLE: Duration = Duration::from_millis(350);

const ENABLED_KEY: &str = "pin.enabled";
const SOURCE_KEY: &str = "pin.source";
const MODE_KEY: &str = "pin.mode";
const EDGE_KEY: &str = "pin.edge";
const TOPMOST_KEY: &str = "pin.topmost";
const DRAWER_MONITOR_KEY: &str = "pin.drawer_monitor";
const DRAWER_OFFSET_KEY: &str = "pin.drawer_offset";
const FLOAT_RECT_KEY: &str = "pin.float_rect";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
pub enum PinSource {
    Tag(i64),
    Cabinet(i64),
}

impl PinSource {
    fn to_setting(self) -> String {
        match self {
            PinSource::Tag(id) => format!("tag:{id}"),
            PinSource::Cabinet(id) => format!("cabinet:{id}"),
        }
    }
    fn from_setting(s: &str) -> Option<Self> {
        let (kind, id) = s.split_once(':')?;
        let id = id.trim().parse().ok()?;
        match kind {
            "tag" => Some(PinSource::Tag(id)),
            "cabinet" => Some(PinSource::Cabinet(id)),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PinMode {
    #[default]
    Float,
    Drawer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PinEdge {
    Left,
    #[default]
    Right,
}

/// 用户可改的设置（设置页 / 托盘）
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinSettings {
    pub enabled: bool,
    pub source: Option<PinSource>,
    pub mode: PinMode,
    pub edge: PinEdge,
    pub topmost: bool,
}

impl Default for PinSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            source: None,
            mode: PinMode::Float,
            edge: PinEdge::Right,
            topmost: true,
        }
    }
}

impl PinSettings {
    pub fn from_settings(get: impl Fn(&str) -> Option<String>) -> Self {
        Self {
            enabled: get(ENABLED_KEY).as_deref() == Some("1"),
            source: get(SOURCE_KEY).as_deref().and_then(PinSource::from_setting),
            mode: if get(MODE_KEY).as_deref() == Some("drawer") {
                PinMode::Drawer
            } else {
                PinMode::Float
            },
            edge: if get(EDGE_KEY).as_deref() == Some("left") {
                PinEdge::Left
            } else {
                PinEdge::Right
            },
            topmost: get(TOPMOST_KEY).as_deref() != Some("0"),
        }
    }

    pub fn to_settings(self) -> Vec<(&'static str, String)> {
        let flag = |b: bool| if b { "1" } else { "0" }.to_string();
        vec![
            (ENABLED_KEY, flag(self.enabled)),
            (
                SOURCE_KEY,
                self.source.map(PinSource::to_setting).unwrap_or_default(),
            ),
            (
                MODE_KEY,
                match self.mode {
                    PinMode::Float => "float",
                    PinMode::Drawer => "drawer",
                }
                .into(),
            ),
            (
                EDGE_KEY,
                match self.edge {
                    PinEdge::Left => "left",
                    PinEdge::Right => "right",
                }
                .into(),
            ),
            (TOPMOST_KEY, flag(self.topmost)),
        ]
    }

    /// 开启且有来源才真正显示
    pub fn active(&self) -> bool {
        self.enabled && self.source.is_some()
    }
}

/// 记忆的位置（随拖动自动更新，不在设置页编辑）
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PinPlace {
    pub drawer_monitor: Option<String>,
    /// 抽屉在工作区里的上下位置：0 = 顶、1 = 底
    pub drawer_offset: f64,
    /// 浮动窗：物理左上角 + 逻辑宽高
    pub float_rect: Option<(i32, i32, f64, f64)>,
}

impl PinPlace {
    fn from_settings(get: impl Fn(&str) -> Option<String>) -> Self {
        let float_rect = get(FLOAT_RECT_KEY).and_then(|s| {
            let p: Vec<&str> = s.split(',').collect();
            if p.len() != 4 {
                return None;
            }
            Some((
                p[0].trim().parse().ok()?,
                p[1].trim().parse().ok()?,
                p[2].trim().parse().ok()?,
                p[3].trim().parse().ok()?,
            ))
        });
        Self {
            drawer_monitor: get(DRAWER_MONITOR_KEY).filter(|s| !s.is_empty()),
            drawer_offset: get(DRAWER_OFFSET_KEY)
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|v| v.is_finite())
                .map(|v| v.clamp(0.0, 1.0))
                .unwrap_or(0.5),
            float_rect,
        }
    }

    fn to_settings(&self) -> Vec<(&'static str, String)> {
        vec![
            (
                DRAWER_MONITOR_KEY,
                self.drawer_monitor.clone().unwrap_or_default(),
            ),
            (DRAWER_OFFSET_KEY, format!("{:.4}", self.drawer_offset)),
            (
                FLOAT_RECT_KEY,
                self.float_rect
                    .map(|(x, y, w, h)| format!("{x},{y},{w:.0},{h:.0}"))
                    .unwrap_or_default(),
            ),
        ]
    }
}

// ───────────────────────────── 纯几何（单测） ─────────────────────────────

/// 物理像素矩形 (x, y, w, h)
pub type Rect = (i32, i32, u32, u32);

/// 抽屉在工作区里的矩形。`width` 为当前宽度（把手宽 … 面板宽），贴 `edge` 锚定。
pub fn drawer_rect(work: Rect, edge: PinEdge, offset: f64, width: u32, height: u32) -> Rect {
    let (wx, wy, ww, wh) = work;
    let width = width.min(ww);
    let height = height.min(wh);
    let free = wh.saturating_sub(height) as f64;
    let y = wy + (free * offset.clamp(0.0, 1.0)).round() as i32;
    let x = match edge {
        PinEdge::Left => wx,
        PinEdge::Right => wx + (ww - width) as i32,
    };
    (x, y, width, height)
}

/// 抽屉面板的物理尺寸（按显示器缩放）
pub fn drawer_size(work: Rect, scale: f64) -> (u32, u32) {
    let w = (DRAWER_WIDTH * scale).round() as u32;
    let max_h = (DRAWER_MAX_HEIGHT * scale).round() as u32;
    let h = ((work.3 as f64 * DRAWER_HEIGHT_FRACTION).round() as u32).min(max_h);
    (w, h.max(1))
}

pub fn handle_width(scale: f64) -> u32 {
    ((HANDLE_WIDTH * scale).round() as u32).max(3)
}

/// 动画第 `step`（1..=steps）步的宽度（ease-out）
pub fn anim_width(from: u32, to: u32, step: u32, steps: u32) -> u32 {
    let t = (step as f64 / steps.max(1) as f64).clamp(0.0, 1.0);
    let eased = 1.0 - (1.0 - t) * (1.0 - t);
    (from as f64 + (to as f64 - from as f64) * eased).round() as u32
}

/// 拖动松手后吸附：窗口中心落在哪块显示器（都不在则最近的一块）、靠左还是靠右、上下比例。
/// `monitors` 为各显示器工作区；返回 (显示器下标, 边, 比例)。
pub fn snap(window: Rect, monitors: &[Rect]) -> Option<(usize, PinEdge, f64)> {
    if monitors.is_empty() {
        return None;
    }
    let cx = window.0 + window.2 as i32 / 2;
    let cy = window.1 + window.3 as i32 / 2;
    let dist = |m: &Rect| -> i64 {
        let dx = if cx < m.0 {
            (m.0 - cx) as i64
        } else if cx >= m.0 + m.2 as i32 {
            (cx - (m.0 + m.2 as i32) + 1) as i64
        } else {
            0
        };
        let dy = if cy < m.1 {
            (m.1 - cy) as i64
        } else if cy >= m.1 + m.3 as i32 {
            (cy - (m.1 + m.3 as i32) + 1) as i64
        } else {
            0
        };
        dx * dx + dy * dy
    };
    let (index, m) = monitors.iter().enumerate().min_by_key(|(_, m)| dist(m))?;
    let edge = if cx < m.0 + m.2 as i32 / 2 {
        PinEdge::Left
    } else {
        PinEdge::Right
    };
    let free = m.3.saturating_sub(window.3) as f64;
    let offset = if free <= 0.0 {
        0.5
    } else {
        ((window.1 - m.1) as f64 / free).clamp(0.0, 1.0)
    };
    Some((index, edge, offset))
}

/// 浮动窗记忆的左上角是否还在某块显示器的工作区里（显示器拔掉 / 分辨率变了则不在）
pub fn point_on_any(x: i32, y: i32, monitors: &[Rect]) -> bool {
    monitors
        .iter()
        .any(|m| x >= m.0 && y >= m.1 && x < m.0 + m.2 as i32 && y < m.1 + m.3 as i32)
}

/// 浮动窗默认位置：工作区右侧、竖直居中，留 24 逻辑像素边距
pub fn float_default(work: Rect, w: u32, h: u32, scale: f64) -> (i32, i32) {
    let margin = (24.0 * scale).round() as i32;
    let x = work.0 + work.2 as i32 - w as i32 - margin;
    let y = work.1 + (work.3.saturating_sub(h) / 2) as i32;
    (x.max(work.0), y.max(work.1))
}

// ───────────────────────────── 运行期状态 ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Search,
    Pin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DrawerState {
    Collapsed,
    Expanded,
    /// 前台全屏：把手隐藏
    HiddenFullscreen,
}

struct Runtime {
    settings: PinSettings,
    place: PinPlace,
    surface: Surface,
    drawer: DrawerState,
    /// 我们自己挪窗口后的一小段时间里忽略 Moved（不当成用户拖动）
    ignore_moves_until: Option<Instant>,
    /// 系统拖动循环进行中（EVENT_SYSTEM_MOVESIZESTART..END）：期间不收回抽屉
    dragging: bool,
}

static RUNTIME: Mutex<Runtime> = Mutex::new(Runtime {
    settings: PinSettings {
        enabled: false,
        source: None,
        mode: PinMode::Float,
        edge: PinEdge::Right,
        topmost: true,
    },
    place: PinPlace {
        drawer_monitor: None,
        drawer_offset: 0.5,
        float_rect: None,
    },
    surface: Surface::Search,
    drawer: DrawerState::Collapsed,
    ignore_moves_until: None,
    dragging: false,
});
/// 动画 / 拖动结束计时的代数：新的操作让旧的作废
static ANIM_GEN: AtomicU64 = AtomicU64::new(0);
static MOVE_GEN: AtomicU64 = AtomicU64::new(0);

fn rt() -> std::sync::MutexGuard<'static, Runtime> {
    RUNTIME.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn settings() -> PinSettings {
    rt().settings
}

pub fn active() -> bool {
    rt().settings.active()
}

pub fn surface() -> Surface {
    rt().surface
}

/// data_sync 是否把 quick 窗口算作「可见」：收起的把手 / 全屏隐藏不算（不因常驻把手提高检测频率）
pub fn counts_as_visible() -> bool {
    let r = rt();
    !(r.surface == Surface::Pin
        && r.settings.mode == PinMode::Drawer
        && r.drawer != DrawerState::Expanded)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinView {
    pub surface: Surface,
    pub settings: PinSettings,
    pub drawer: DrawerState,
}

fn view() -> PinView {
    let r = rt();
    PinView {
        surface: r.surface,
        settings: r.settings,
        drawer: r.drawer,
    }
}

fn emit_view(window: &WebviewWindow) {
    let _ = window.emit(PIN_SURFACE_EVENT, view());
}

/// 启动：读设置；开启时延迟创建 quick 窗口并显示钉住视图。
pub fn init(app: &AppHandle) {
    {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        let get = |k: &str| settings_service::get_setting(&conn, k);
        let mut r = rt();
        r.settings = PinSettings::from_settings(get);
        r.place = PinPlace::from_settings(|k| settings_service::get_setting(&conn, k));
    }
    if active() {
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("tl-pin-init".into())
            .spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                if let Err(e) = restore(&app) {
                    log::warn!("[pin] {e}");
                }
            });
    }
}

fn save_place(app: &AppHandle) {
    let place = rt().place.clone();
    let db = app.state::<Database>();
    let conn = db.get_conn();
    for (k, v) in place.to_settings() {
        if let Err(e) = settings_service::set_setting(&conn, k, &v) {
            log::warn!("[pin] 保存位置失败：{e}");
        }
    }
}

fn monitors(app: &AppHandle) -> Vec<tauri::Monitor> {
    app.available_monitors().unwrap_or_default()
}

fn work_of(m: &tauri::Monitor) -> Rect {
    let a = m.work_area();
    (a.position.x, a.position.y, a.size.width, a.size.height)
}

/// 抽屉所在显示器：记住的名字 → 主显示器 → 第一块
fn drawer_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let wanted = rt().place.drawer_monitor.clone();
    let all = monitors(app);
    if let Some(name) = wanted {
        if let Some(m) = all.iter().find(|m| m.name() == Some(&name)) {
            return Some(m.clone());
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| all.into_iter().next())
}

fn ignore_own_moves() {
    rt().ignore_moves_until = Some(Instant::now() + Duration::from_millis(400));
}

/// 不激活地设置窗口边界（Windows 上一次 SetWindowPos，避免先挪后改尺寸的闪烁）
fn set_bounds(window: &WebviewWindow, r: Rect) {
    ignore_own_moves();
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
        };
        if let Ok(h) = window.hwnd() {
            // SAFETY：hwnd 来自本进程窗口；SetWindowPos 只改几何
            unsafe {
                SetWindowPos(
                    h.0 as _,
                    std::ptr::null_mut(),
                    r.0,
                    r.1,
                    r.2 as i32,
                    r.3 as i32,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                );
            }
            return;
        }
    }
    let _ = window.set_size(tauri::PhysicalSize::new(r.2, r.3));
    let _ = window.set_position(tauri::PhysicalPosition::new(r.0, r.1));
}

/// 隐藏：tauri 的 hide（同步 tao 内部的可见标志，否则之后 tauri show 会被当成已可见而跳过）
/// + 原生 SW_HIDE（窗口是 show_no_activate 原生显示的，tao 标志可能仍是「隐藏」，它的 hide 是空操作）
fn hide_window(window: &WebviewWindow) {
    let _ = window.hide();
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
}

/// 显示但不抢前台
fn show_no_activate(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        if let Ok(h) = window.hwnd() {
            // SAFETY：hwnd 来自本进程窗口
            unsafe {
                ShowWindow(h.0 as _, SW_SHOWNOACTIVATE);
            }
            return;
        }
    }
    let _ = window.show();
}

fn place_float(app: &AppHandle, window: &WebviewWindow) {
    let all = monitors(app);
    let works: Vec<Rect> = all.iter().map(work_of).collect();
    let remembered = rt().place.float_rect;
    let (x, y, lw, lh) = match remembered {
        Some((x, y, w, h)) if point_on_any(x, y, &works) => (x, y, w, h),
        _ => {
            let m = app
                .primary_monitor()
                .ok()
                .flatten()
                .or_else(|| all.first().cloned());
            let Some(m) = m else {
                let _ = window.center();
                return;
            };
            let s = m.scale_factor();
            let (w, h) = (
                (FLOAT_DEFAULT.0 * s).round() as u32,
                (FLOAT_DEFAULT.1 * s).round() as u32,
            );
            let (x, y) = float_default(work_of(&m), w, h, s);
            (x, y, FLOAT_DEFAULT.0, FLOAT_DEFAULT.1)
        }
    };
    let scale = app
        .monitor_from_point(x as f64, y as f64)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let r = (
        x,
        y,
        (lw.max(FLOAT_MIN.0) * scale).round() as u32,
        (lh.max(FLOAT_MIN.1) * scale).round() as u32,
    );
    // 跨 DPI 移动时系统会按新 DPI 建议矩形改尺寸：设两次，第二次按目标显示器归位
    set_bounds(window, r);
    set_bounds(window, r);
}

fn drawer_geometry(app: &AppHandle, expanded: bool) -> Option<(Rect, u32, u32)> {
    let m = drawer_monitor(app)?;
    let scale = m.scale_factor();
    let work = work_of(&m);
    let (pw, ph) = drawer_size(work, scale);
    let hw = handle_width(scale);
    let (edge, offset) = {
        let r = rt();
        (r.settings.edge, r.place.drawer_offset)
    };
    let width = if expanded { pw } else { hw };
    Some((drawer_rect(work, edge, offset, width, ph), pw, hw))
}

/// 展开动画的起始宽度：从面板宽的 1/4 起滑（不让 WebView 经过极窄宽度）
fn anim_start(pw: u32, hw: u32) -> u32 {
    (pw / 4).max(hw)
}

/// 收起：quick 窗口隐藏，原生把手贴边显示（见 pin_strip）
fn show_handle(app: &AppHandle) {
    if let Some((rect, _, _)) = drawer_geometry(app, false) {
        crate::pin_strip::show(app, rect);
    }
}

/// 切到钉住视图表面（搜索收起、设置变化、启动、托盘切换时调用）。未开启时隐藏窗口。
pub fn restore(app: &AppHandle) -> Result<(), String> {
    ANIM_GEN.fetch_add(1, Ordering::SeqCst);
    let settings = settings();
    if !settings.active() {
        rt().surface = Surface::Search;
        set_foreground_hook(app, false);
        crate::pin_strip::hide(app);
        if let Some(w) = app.get_webview_window(crate::quick::QUICK_LABEL) {
            hide_window(&w);
            emit_view(&w);
        }
        return Ok(());
    }
    let window = crate::quick::ensure_window(app)?;
    {
        let mut r = rt();
        r.surface = Surface::Pin;
        r.drawer = DrawerState::Collapsed;
    }
    match settings.mode {
        PinMode::Float => {
            set_foreground_hook(app, false);
            crate::pin_strip::hide(app);
            let _ = window.set_always_on_top(settings.topmost);
            let _ = window.set_resizable(true);
            place_float(app, &window);
            emit_view(&window);
            show_no_activate(&window);
        }
        PinMode::Drawer => {
            let _ = window.set_always_on_top(true);
            let _ = window.set_resizable(false);
            // 收起 = quick 窗口隐藏（WebView 不画），只留原生把手
            hide_window(&window);
            emit_view(&window);
            set_foreground_hook(app, true);
            if crate::desktop::fullscreen_foreground_monitor()
                .is_some_and(|fs| Some(fs) == drawer_hmonitor(app))
            {
                rt().drawer = DrawerState::HiddenFullscreen;
                crate::pin_strip::hide(app);
                emit_view(&window);
            } else {
                show_handle(app);
            }
        }
    }
    Ok(())
}

/// 快速搜索唤出前调用：切回搜索表面（尺寸 / 位置由 quick 负责）
pub fn enter_search(window: &WebviewWindow) {
    ANIM_GEN.fetch_add(1, Ordering::SeqCst);
    let was_pin = {
        let mut r = rt();
        let was = r.surface == Surface::Pin;
        r.surface = Surface::Search;
        r.drawer = DrawerState::Collapsed;
        was
    };
    if was_pin {
        crate::pin_strip::hide(window.app_handle());
        let _ = window.set_resizable(false);
        let _ = window.set_always_on_top(true);
        ignore_own_moves();
        emit_view(window);
    }
}

/// 抽屉所在显示器的 HMONITOR（按把手矩形中心点取；收起时 quick 窗口是隐藏的，不能按窗口取）
fn drawer_hmonitor(app: &AppHandle) -> Option<isize> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
        let (rect, _, _) = drawer_geometry(app, false)?;
        let pt = POINT {
            x: rect.0 + rect.2 as i32 / 2,
            y: rect.1 + rect.3 as i32 / 2,
        };
        // SAFETY：只读查询
        Some(unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) } as isize)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

fn fullscreen_on_drawer_monitor(app: &AppHandle) -> bool {
    match crate::desktop::fullscreen_foreground_monitor() {
        Some(fs) => drawer_hmonitor(app).map_or(true, |m| m == fs),
        None => false,
    }
}

/// 把手收到鼠标进入：滑出。返回是否展开（全屏 / 非抽屉 / 已展开时 false）。
pub fn expand(app: &AppHandle) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(crate::quick::QUICK_LABEL) else {
        return Ok(false);
    };
    {
        let r = rt();
        if r.surface != Surface::Pin
            || r.settings.mode != PinMode::Drawer
            || r.drawer != DrawerState::Collapsed
        {
            return Ok(false);
        }
    }
    if fullscreen_on_drawer_monitor(app) {
        rt().drawer = DrawerState::HiddenFullscreen;
        crate::pin_strip::hide(app);
        hide_window(&window);
        emit_view(&window);
        return Ok(false);
    }
    let Some((_, pw, hw)) = drawer_geometry(app, false) else {
        return Ok(false);
    };
    rt().drawer = DrawerState::Expanded;
    emit_view(&window);
    let start = anim_start(pw, hw);
    if let Some((r, _, _)) = drawer_geometry(app, true) {
        let (edge, x) = (rt().settings.edge, r.0);
        let sx = if edge == PinEdge::Right {
            x + (pw - start) as i32
        } else {
            x
        };
        set_bounds(&window, (sx, r.1, start, r.3));
    }
    show_no_activate(&window);
    crate::pin_strip::hide(app);
    animate(app, &window, start, pw);
    Ok(true)
}

/// 鼠标离开面板 / 失焦 / Esc / 打开对象后：收回成把手。
/// `from_leave`：前端 mouseleave 计时触发——光标其实还在窗口里（开始拖动时 WebView 会误报离开）就不收。
/// 系统拖动循环进行中一律不收（拖动循环按起始尺寸摆窗口，收起会被它改回去，状态就乱了）。
pub fn collapse(app: &AppHandle, from_leave: bool) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(crate::quick::QUICK_LABEL) else {
        return Ok(false);
    };
    {
        let r = rt();
        if r.surface != Surface::Pin || r.drawer != DrawerState::Expanded || r.dragging {
            return Ok(false);
        }
    }
    if from_leave && cursor_inside(&window) {
        return Ok(false);
    }
    let Some((_, pw, hw)) = drawer_geometry(app, false) else {
        return Ok(false);
    };
    rt().drawer = DrawerState::Collapsed;
    animate(app, &window, pw, anim_start(pw, hw));
    show_handle(app);
    hide_window(&window);
    emit_view(&window);
    Ok(true)
}

/// 贴边锚定地把宽度从 `from` 变到 `to`（几步，阻塞调用线程约 ANIM_STEPS × ANIM_STEP）
fn animate(app: &AppHandle, window: &WebviewWindow, from: u32, to: u32) {
    let gen = ANIM_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(m) = drawer_monitor(app) else {
        return;
    };
    let work = work_of(&m);
    let (_, ph) = drawer_size(work, m.scale_factor());
    let (edge, offset) = {
        let r = rt();
        (r.settings.edge, r.place.drawer_offset)
    };
    for step in 1..=ANIM_STEPS {
        if ANIM_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        let w = anim_width(from, to, step, ANIM_STEPS);
        set_bounds(window, drawer_rect(work, edge, offset, w, ph));
        if step < ANIM_STEPS {
            std::thread::sleep(ANIM_STEP);
        }
    }
}

fn cursor_inside(window: &WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{POINT, RECT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};
        let Ok(h) = window.hwnd() else {
            return false;
        };
        let mut pt = POINT { x: 0, y: 0 };
        let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY：只读查询本进程窗口与光标位置
        unsafe {
            if GetCursorPos(&mut pt) == 0 || GetWindowRect(h.0 as _, &mut rc) == 0 {
                return false;
            }
        }
        pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}

/// quick 窗口失焦：钉住表面下只有展开的抽屉收回
pub fn on_blur(app: &AppHandle) {
    let expanded = {
        let r = rt();
        r.surface == Surface::Pin && r.drawer == DrawerState::Expanded
    };
    if expanded {
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = collapse(&app, false);
        });
    }
}

/// quick 窗口移动 / 改尺寸：浮动窗静默 DRAG_SETTLE 后记位置
pub fn on_moved(app: &AppHandle) {
    {
        let r = rt();
        if r.surface != Surface::Pin {
            return;
        }
        if r.ignore_moves_until.is_some_and(|t| Instant::now() < t) {
            return;
        }
        // 抽屉的拖动在系统拖动循环结束（EVENT_SYSTEM_MOVESIZEEND）时吸附，见 movesize_proc
        if r.settings.mode == PinMode::Drawer {
            return;
        }
    }
    let gen = MOVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(DRAG_SETTLE);
        if MOVE_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        settle_after_move(&app);
    });
}

fn settle_after_move(app: &AppHandle) {
    let Some(window) = app.get_webview_window(crate::quick::QUICK_LABEL) else {
        return;
    };
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let rect: Rect = (pos.x, pos.y, size.width, size.height);
    let mode = settings().mode;
    match mode {
        PinMode::Float => {
            rt().place.float_rect = Some((
                rect.0,
                rect.1,
                (rect.2 as f64 / scale).round(),
                (rect.3 as f64 / scale).round(),
            ));
            save_place(app);
        }
        PinMode::Drawer => {
            let all = monitors(app);
            let works: Vec<Rect> = all.iter().map(work_of).collect();
            let Some((index, edge, offset)) = snap(rect, &works) else {
                return;
            };
            let name = all[index].name().cloned();
            let changed_edge = {
                let mut r = rt();
                r.place.drawer_monitor = name;
                r.place.drawer_offset = offset;
                let changed = r.settings.edge != edge;
                r.settings.edge = edge;
                changed
            };
            save_place(app);
            if changed_edge {
                let db = app.state::<Database>();
                let conn = db.get_conn();
                let edge_value = if edge == PinEdge::Left {
                    "left"
                } else {
                    "right"
                };
                let _ = settings_service::set_setting(&conn, EDGE_KEY, edge_value);
            }
            if let Some((r, _, _)) = drawer_geometry(app, true) {
                set_bounds(&window, r);
                set_bounds(&window, r);
            }
            emit_view(&window);
        }
    }
}

/// 前台变化（WinEvent 回调，主线程）：抽屉把手按前台全屏隐藏 / 恢复
fn on_foreground_changed(app: &AppHandle) {
    let (surface, mode, drawer) = {
        let r = rt();
        (r.surface, r.settings.mode, r.drawer)
    };
    if surface != Surface::Pin || mode != PinMode::Drawer {
        return;
    }
    let Some(window) = app.get_webview_window(crate::quick::QUICK_LABEL) else {
        return;
    };
    let fullscreen = fullscreen_on_drawer_monitor(app);
    match (drawer, fullscreen) {
        (DrawerState::HiddenFullscreen, false) => {
            rt().drawer = DrawerState::Collapsed;
            emit_view(&window);
            show_handle(app);
        }
        (DrawerState::Collapsed | DrawerState::Expanded, true) => {
            ANIM_GEN.fetch_add(1, Ordering::SeqCst);
            rt().drawer = DrawerState::HiddenFullscreen;
            crate::pin_strip::hide(app);
            hide_window(&window);
            emit_view(&window);
        }
        _ => {}
    }
}

// ── 前台切换事件钩子（只在抽屉模式开启时装） ──

#[cfg(windows)]
static HOOK_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
#[cfg(windows)]
static HOOK: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
/// 本进程窗口的拖动结束事件（只看自己的进程），抽屉松手吸附用
#[cfg(windows)]
static MOVE_HOOK: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

#[cfg(windows)]
unsafe extern "system" fn movesize_proc(
    _hook: windows_sys::Win32::UI::Accessibility::HWINEVENTHOOK,
    event: u32,
    hwnd: windows_sys::Win32::Foundation::HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let Some(app) = HOOK_APP.get() else {
        return;
    };
    let Some(window) = app.get_webview_window(crate::quick::QUICK_LABEL) else {
        return;
    };
    if window.hwnd().ok().map(|h| h.0 as isize) != Some(hwnd as isize) {
        return;
    }
    if event == windows_sys::Win32::UI::WindowsAndMessaging::EVENT_SYSTEM_MOVESIZESTART {
        rt().dragging = true;
        return;
    }
    let dragging_drawer = {
        let mut r = rt();
        r.dragging = false;
        r.surface == Surface::Pin
            && r.settings.mode == PinMode::Drawer
            && r.drawer == DrawerState::Expanded
    };
    if dragging_drawer {
        let app = app.clone();
        std::thread::spawn(move || settle_after_move(&app));
    }
}

#[cfg(windows)]
unsafe extern "system" fn foreground_proc(
    _hook: windows_sys::Win32::UI::Accessibility::HWINEVENTHOOK,
    _event: u32,
    _hwnd: windows_sys::Win32::Foundation::HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if let Some(app) = HOOK_APP.get() {
        on_foreground_changed(app);
    }
}

fn set_foreground_hook(app: &AppHandle, on: bool) {
    #[cfg(windows)]
    {
        let _ = HOOK_APP.set(app.clone());
        let install = move || {
            use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART,
                WINEVENT_OUTOFCONTEXT,
                WINEVENT_SKIPOWNPROCESS,
            };
            let current = HOOK.load(Ordering::SeqCst);
            if on && current == 0 {
                // SAFETY：回调为 'static 函数；OUTOFCONTEXT 事件投递到本线程（主线程）的消息循环
                let h = unsafe {
                    SetWinEventHook(
                        EVENT_SYSTEM_FOREGROUND,
                        EVENT_SYSTEM_FOREGROUND,
                        std::ptr::null_mut(),
                        Some(foreground_proc),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                    )
                };
                HOOK.store(h as isize, Ordering::SeqCst);
                // SAFETY：同上；只订阅本进程窗口的拖动结束
                let m = unsafe {
                    SetWinEventHook(
                        EVENT_SYSTEM_MOVESIZESTART,
                        EVENT_SYSTEM_MOVESIZEEND,
                        std::ptr::null_mut(),
                        Some(movesize_proc),
                        std::process::id(),
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    )
                };
                MOVE_HOOK.store(m as isize, Ordering::SeqCst);
            } else if !on && current != 0 {
                // SAFETY：current / MOVE_HOOK 是本线程装的钩子
                unsafe {
                    UnhookWinEvent(current as _);
                    let m = MOVE_HOOK.swap(0, Ordering::SeqCst);
                    if m != 0 {
                        UnhookWinEvent(m as _);
                    }
                }
                HOOK.store(0, Ordering::SeqCst);
            }
        };
        if let Err(e) = app.run_on_main_thread(install) {
            log::warn!("[pin] 前台事件钩子切换失败：{e}");
        }
    }
    #[cfg(not(windows))]
    let _ = (app, on);
}

/// 前台事件钩子是否已装（E2E / 诊断用）
pub fn hook_installed() -> bool {
    #[cfg(windows)]
    {
        HOOK.load(Ordering::SeqCst) != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

// ───────────────────────────── 数据 ─────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinItems {
    pub source: Option<PinSource>,
    /// 来源名（标签名 / 柜路径名）；来源已删除时为 None
    pub title: Option<String>,
    pub total: usize,
    pub items: Vec<crate::models::item::ItemWithTags>,
}

/// 钉住视图内容：柜含全部子柜（F16 默认口径）、标签含全部子标签；排序同文件柜视图。
pub fn load_items(
    conn: &rusqlite::Connection,
    source: Option<PinSource>,
) -> Result<PinItems, String> {
    use crate::services::{cabinet_service, item_service, tag_service};
    let Some(src) = source else {
        return Ok(PinItems {
            source,
            title: None,
            total: 0,
            items: Vec::new(),
        });
    };
    let (title, mut items) = match src {
        PinSource::Cabinet(id) => {
            let cabinets = cabinet_service::get_cabinets(conn)?;
            if !cabinets.iter().any(|c| c.id == id) {
                return Ok(PinItems {
                    source,
                    title: None,
                    total: 0,
                    items: Vec::new(),
                });
            }
            let title = cabinet_path(&cabinets, id);
            (title, cabinet_service::get_cabinet_items(conn, id, true)?)
        }
        PinSource::Tag(id) => {
            let name: Option<String> = conn
                .query_row("SELECT name FROM tags WHERE id = ?1", [id], |r| r.get(0))
                .ok();
            let Some(name) = name else {
                return Ok(PinItems {
                    source,
                    title: None,
                    total: 0,
                    items: Vec::new(),
                });
            };
            let tags = tag_service::expand_with_descendants(conn, &[id])?;
            let placeholders = tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT DISTINCT item_id FROM item_tags WHERE tag_id IN ({placeholders})"
                ))
                .map_err(|e| e.to_string())?;
            let params: Vec<&dyn rusqlite::ToSql> =
                tags.iter().map(|t| t as &dyn rusqlite::ToSql).collect();
            let ids: Vec<i64> = stmt
                .query_map(params.as_slice(), |r| r.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            let mut items = item_service::get_items_by_ids(conn, &ids)?;
            cabinet_service::sort_like_cabinet(&mut items);
            (name, items)
        }
    };
    let total = items.len();
    items.truncate(PIN_ITEMS_LIMIT);
    Ok(PinItems {
        source,
        title: Some(title),
        total,
        items,
    })
}

fn cabinet_path(cabinets: &[crate::models::cabinet::Cabinet], id: i64) -> String {
    let mut names = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut current = cabinets.iter().find(|c| c.id == id);
    while let Some(c) = current {
        if !seen.insert(c.id) {
            break;
        }
        names.push(c.name.clone());
        current = c
            .parent_id
            .and_then(|p| cabinets.iter().find(|x| x.id == p));
    }
    names.reverse();
    names.join(" / ")
}

/// 来源必须存在（设置时校验）
pub fn validate_source(conn: &rusqlite::Connection, source: PinSource) -> Result<(), String> {
    let (sql, what) = match source {
        PinSource::Tag(_) => ("SELECT 1 FROM tags WHERE id = ?1", "标签"),
        PinSource::Cabinet(_) => ("SELECT 1 FROM cabinets WHERE id = ?1", "文件柜"),
    };
    let id = match source {
        PinSource::Tag(id) | PinSource::Cabinet(id) => id,
    };
    conn.query_row(sql, [id], |_| Ok(()))
        .map_err(|_| format!("{what}不存在（id {id}），可能已被删除"))
}

/// 托盘切换 / 设置保存：落库并按新设置显示或隐藏
pub fn apply_settings(app: &AppHandle, next: PinSettings) -> Result<PinSettings, String> {
    crate::db::ensure_writes_allowed()?;
    {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        if let Some(src) = next.source {
            validate_source(&conn, src)?;
        } else if next.enabled {
            return Err("请先选择钉住视图要显示的标签或文件柜".into());
        }
        for (k, v) in next.to_settings() {
            settings_service::set_setting(&conn, k, &v)?;
        }
    }
    let was_active = active();
    rt().settings = next;
    // 搜索表面在用时不打断（收起时自然还原到新的钉住视图）
    let searching = surface() == Surface::Search
        && app
            .get_webview_window(crate::quick::QUICK_LABEL)
            .is_some_and(|w| w.is_visible().unwrap_or(false));
    if !searching {
        restore(app)?;
    }
    if was_active && !next.active() {
        // 快速搜索也没开：销毁 quick 窗口（与关闭快速搜索同一路径，在主线程销毁）
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            crate::quick::sync_window(&handle, crate::desktop::quick_window_needed(&handle));
        });
    }
    crate::desktop::refresh_tray(app);
    Ok(next)
}

// ───────────────────────────── 命令 ─────────────────────────────

#[tauri::command]
pub fn get_pin_settings() -> PinSettings {
    settings()
}

#[tauri::command]
pub async fn set_pin_settings(
    app: AppHandle,
    settings: PinSettings,
) -> Result<PinSettings, String> {
    apply_settings(&app, settings)
}

#[tauri::command]
pub fn pin_state() -> PinView {
    view()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinDiag {
    pub view: PinView,
    pub hook_installed: bool,
    pub counts_as_visible: bool,
    /// 原生把手：是否显示与物理矩形 [x, y, w, h]
    pub handle_visible: bool,
    pub handle_rect: [i64; 4],
}

#[tauri::command]
pub fn pin_diag() -> PinDiag {
    let (handle_visible, r) = crate::pin_strip::state();
    PinDiag {
        view: view(),
        hook_installed: hook_installed(),
        counts_as_visible: counts_as_visible(),
        handle_visible,
        handle_rect: [r.0 as i64, r.1 as i64, r.2 as i64, r.3 as i64],
    }
}

#[tauri::command(async)]
pub fn pin_items(db: tauri::State<Database>) -> Result<PinItems, String> {
    let ro = db.read_conn()?;
    load_items(ro.conn(), settings().source)
}

#[tauri::command]
pub async fn pin_expand(app: AppHandle) -> Result<bool, String> {
    expand(&app)
}

#[tauri::command]
pub async fn pin_collapse(app: AppHandle, from_leave: Option<bool>) -> Result<bool, String> {
    collapse(&app, from_leave.unwrap_or(false))
}

/// 前端告知主题强调色，用于原生把手
#[tauri::command]
pub fn pin_handle_color(app: AppHandle, color: String) {
    crate::pin_strip::set_color(&app, &color);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn settings_round_trip_and_defaults_off() {
        let none = PinSettings::from_settings(|_| None);
        assert_eq!(none, PinSettings::default());
        assert!(!none.enabled && !none.active());
        let s = PinSettings {
            enabled: true,
            source: Some(PinSource::Cabinet(7)),
            mode: PinMode::Drawer,
            edge: PinEdge::Left,
            topmost: false,
        };
        let stored: HashMap<&str, String> = s.to_settings().into_iter().collect();
        let back = PinSettings::from_settings(|k| stored.get(k).cloned());
        assert_eq!(back, s);
        assert!(back.active());
        let bad = PinSettings::from_settings(|k| (k == SOURCE_KEY).then(|| "folder:3".to_string()));
        assert_eq!(bad.source, None);
        assert_eq!(
            serde_json::to_value(PinSource::Tag(3)).unwrap(),
            serde_json::json!({"kind": "tag", "id": 3})
        );
    }

    #[test]
    fn place_round_trip_and_clamps() {
        let p = PinPlace {
            drawer_monitor: Some("\\\\.\\DISPLAY2".into()),
            drawer_offset: 0.25,
            float_rect: Some((-1500, 40, 340.0, 480.0)),
        };
        let stored: HashMap<&str, String> = p.to_settings().into_iter().collect();
        assert_eq!(PinPlace::from_settings(|k| stored.get(k).cloned()), p);
        let odd = PinPlace::from_settings(|k| match k {
            DRAWER_OFFSET_KEY => Some("7".into()),
            FLOAT_RECT_KEY => Some("1,2,3".into()),
            _ => None,
        });
        assert_eq!(odd.drawer_offset, 1.0);
        assert_eq!(odd.float_rect, None);
    }

    #[test]
    fn drawer_rect_anchors_to_edge_and_offset() {
        let work = (0, 0, 1920, 1040);
        assert_eq!(
            drawer_rect(work, PinEdge::Right, 0.5, 320, 640),
            (1600, 200, 320, 640)
        );
        assert_eq!(
            drawer_rect(work, PinEdge::Left, 0.0, 4, 640),
            (0, 0, 4, 640)
        );
        assert_eq!(
            drawer_rect(work, PinEdge::Right, 1.0, 4, 640),
            (1916, 400, 4, 640)
        );
        // 副屏在左侧负坐标
        let left = (-2560, 0, 2560, 1400);
        assert_eq!(drawer_rect(left, PinEdge::Right, 0.0, 480, 896).0, -480);
    }

    #[test]
    fn sizes_follow_dpi() {
        let (w1, h1) = drawer_size((0, 0, 1920, 1040), 1.0);
        assert_eq!((w1, h1), (320, 640));
        let (w2, h2) = drawer_size((0, 0, 2880, 1560), 1.5);
        assert_eq!((w2, h2), (480, 960));
        assert_eq!(handle_width(1.0), 4);
        assert_eq!(handle_width(1.5), 6);
        assert_eq!(handle_width(0.5), 3, "至少 3 物理像素，鼠标碰得到");
    }

    #[test]
    fn anim_width_eases_and_ends_exactly() {
        assert_eq!(anim_width(4, 320, 6, 6), 320);
        assert_eq!(anim_width(320, 4, 6, 6), 4);
        let w1 = anim_width(4, 320, 1, 6);
        let w2 = anim_width(4, 320, 2, 6);
        assert!(w1 > 4 && w2 > w1 && w2 < 320);
        assert!(w1 - 4 > w2 - w1, "ease-out：先快后慢");
    }

    #[test]
    fn snap_picks_monitor_edge_and_offset() {
        let mons = [(0, 0, 1920, 1040), (1920, 0, 2560, 1400)];
        // 拖到第一块屏左半边、偏上
        assert_eq!(
            snap((100, 100, 320, 640), &mons),
            Some((0, PinEdge::Left, 0.25))
        );
        // 拖到第二块屏右半边、最底
        let (i, e, o) = snap((3900, 760, 320, 640), &mons).unwrap();
        assert_eq!((i, e), (1, PinEdge::Right));
        assert!((o - 1.0).abs() < 1e-9);
        // 中心落在所有屏外：取最近的一块
        assert_eq!(snap((5000, 200, 320, 640), &mons).unwrap().0, 1);
        assert_eq!(snap((0, 0, 10, 10), &[]), None);
    }

    #[test]
    fn float_position_validity_and_default() {
        let mons = [(0, 0, 1920, 1040)];
        assert!(point_on_any(100, 100, &mons));
        assert!(!point_on_any(-1500, 40, &mons), "副屏拔掉后回退默认位置");
        assert_eq!(
            float_default((0, 0, 1920, 1040), 340, 480, 1.0),
            (1556, 280)
        );
    }

    fn db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn items_cabinet_includes_children_and_tag_includes_descendants() {
        let conn = db();
        for (i, name) in ["a.txt", "b.txt", "c.txt"].iter().enumerate() {
            conn.execute(
                "INSERT INTO items (id, name, path, type) VALUES (?1, ?2, ?3, 'text')",
                rusqlite::params![i as i64 + 1, name, format!("D:\\{name}")],
            )
            .unwrap();
        }
        conn.execute_batch(
            "INSERT INTO cabinets (id, name, color) VALUES (1, '资料', '#000'), (2, '项目', '#000');
             UPDATE cabinets SET parent_id = 1 WHERE id = 2;
             INSERT INTO cabinet_items (cabinet_id, item_id) VALUES (1, 1), (2, 2);
             INSERT INTO tags (id, name, color) VALUES (10, '工作', '#000'), (11, '报告', '#000');
             INSERT INTO tag_relations (parent_id, child_id) VALUES (10, 11);
             INSERT INTO item_tags (item_id, tag_id) VALUES (3, 11);",
        )
        .unwrap();
        let cab = load_items(&conn, Some(PinSource::Cabinet(1))).unwrap();
        assert_eq!(cab.title.as_deref(), Some("资料"));
        let mut ids: Vec<i64> = cab.items.iter().map(|i| i.item.id).collect();
        ids.sort();
        assert_eq!(ids, vec![1, 2], "父柜含子柜成员");
        let child = load_items(&conn, Some(PinSource::Cabinet(2))).unwrap();
        assert_eq!(child.title.as_deref(), Some("资料 / 项目"));
        let tag = load_items(&conn, Some(PinSource::Tag(10))).unwrap();
        assert_eq!(
            tag.items.iter().map(|i| i.item.id).collect::<Vec<_>>(),
            vec![3]
        );
        let gone = load_items(&conn, Some(PinSource::Cabinet(99))).unwrap();
        assert!(gone.title.is_none() && gone.items.is_empty());
        assert!(validate_source(&conn, PinSource::Tag(10)).is_ok());
        assert!(validate_source(&conn, PinSource::Tag(99))
            .unwrap_err()
            .contains("标签不存在"));
    }
}

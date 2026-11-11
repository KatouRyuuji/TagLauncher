//! 桌面驻留（F18）：托盘、「动作 → 快捷键」全局热键表、关闭窗口行为、启动参数路由。
//!
//! 默认保持旧行为：不注册任何全局快捷键、关闭窗口即退出、不建托盘、不开机自启。
//! 设置保存在 app_meta：每个动作一个键（`hotkey.<action>`），另有 `hotkey.ignore_fullscreen`
//! 与 `desktop.close_action`；这些键只能经本模块的专用命令写入（通用 set_setting 拦截）。
//! 全局快捷键只在 Rust 侧注册（tauri-plugin-global-shortcut），不向前端开放插件权限；
//! 按下时按快捷键查表再分派动作，不写死某个动作。本批只开放 `toggle_main`。

use crate::db::Database;
use crate::services::settings_service;
use serde::Serialize;
use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

pub const CLOSE_ACTION_KEY: &str = "desktop.close_action";
pub const IGNORE_FULLSCREEN_KEY: &str = "hotkey.ignore_fullscreen";
pub const TRAY_ID: &str = "taglauncher-tray";
/// 设置变化后广播（设置页、托盘菜单据此同步）
pub const SETTINGS_CHANGED_EVENT: &str = "desktop-settings-changed";
const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";
const MENU_QUICK: &str = "tray-quick";
/// 前台全屏时被忽略的热键：窗口期内连按 3 次强制执行
const FORCE_PRESSES: usize = 3;
const FORCE_WINDOW: Duration = Duration::from_secs(2);

// ───────────────────────────── 动作表 ─────────────────────────────

/// 可绑定全局快捷键的动作。以后加快速搜索、收纳选中项时在此追加，并逐项注册/回滚。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyAction {
    ToggleMain,
    /// 全局快速搜索窗（阶段②）。绑定快捷键即开启功能（预创建隐藏窗口），清除即关闭（销毁窗口）。
    OpenQuick,
    /// 热键 B（阶段③）：收纳前台资源管理器 / 桌面的选中项；没有选中项时收纳剪贴板里的文件。
    CollectSelection,
}

impl HotkeyAction {
    /// 本批开放的动作（设置页只显示这些）
    pub const ALL: [HotkeyAction; 3] = [
        HotkeyAction::ToggleMain,
        HotkeyAction::OpenQuick,
        HotkeyAction::CollectSelection,
    ];

    pub fn id(self) -> &'static str {
        match self {
            HotkeyAction::ToggleMain => "toggle_main",
            HotkeyAction::OpenQuick => "open_quick",
            HotkeyAction::CollectSelection => "collect_selection",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            HotkeyAction::ToggleMain => "显示 / 隐藏主窗口",
            HotkeyAction::OpenQuick => "打开快速搜索窗",
            HotkeyAction::CollectSelection => "收纳资源管理器选中项",
        }
    }

    /// 设置键名带动作名，避免以后从单字段迁移到多字段
    pub fn setting_key(self) -> String {
        format!("hotkey.{}", self.id())
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        Self::ALL
            .into_iter()
            .find(|a| a.id() == value)
            .ok_or_else(|| format!("未知的快捷键动作「{value}」"))
    }
}

/// 关闭窗口行为：退出（默认，旧行为）/ 最小化到托盘。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseAction {
    Exit,
    Tray,
}

impl CloseAction {
    /// 未设置或无法识别的持久值一律按「退出」处理（不因脏数据改变关闭语义）。
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("tray") => CloseAction::Tray,
            _ => CloseAction::Exit,
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "exit" => Ok(CloseAction::Exit),
            "tray" => Ok(CloseAction::Tray),
            other => Err(format!("未知的关闭行为「{other}」，只能是 exit 或 tray")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            CloseAction::Exit => "exit",
            CloseAction::Tray => "tray",
        }
    }
}

/// 启动方式：首个实例来自进程参数，后续实例经单实例插件转发参数。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMode {
    /// 显示主窗口（默认）
    Show,
    /// 后台启动：不显示主窗，只驻托盘
    Background,
}

/// 解析启动参数（不含 exe 本身）。认 `--show` / `--background`，后出现的生效；
/// `--collect` 之后全是路径数据（见 collect.rs），不再当开关解析，且未显式 `--show` 时按后台启动
/// （右键收纳只弹快速窗，不打扰主窗）。其余参数忽略。参数只当数据，绝不执行。
pub fn parse_launch_args<I, S>(args: I) -> LaunchMode
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut mode = None;
    for arg in args {
        match arg.as_ref() {
            "--show" => mode = Some(LaunchMode::Show),
            "--background" => mode = Some(LaunchMode::Background),
            crate::collect::COLLECT_ARG => return mode.unwrap_or(LaunchMode::Background),
            _ => {}
        }
    }
    mode.unwrap_or(LaunchMode::Show)
}

/// 解析用户录入的快捷键。必须含 Ctrl / Alt / Win 之一：单键或只加 Shift 的组合会拦截日常输入。
pub fn parse_user_shortcut(raw: &str) -> Result<(String, Shortcut), String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("快捷键为空".to_string());
    }
    let shortcut =
        Shortcut::from_str(text).map_err(|e| format!("无法识别的快捷键「{text}」：{e}"))?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(format!(
            "全局快捷键「{text}」至少要包含 Ctrl、Alt 或 Win 之一，避免拦截日常输入"
        ));
    }
    Ok((text.to_string(), shortcut))
}

/// "Ctrl+Alt+KeyK" → "Ctrl+Alt+K"（托盘菜单展示用）
pub fn display_accelerator(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| {
            if part == "Super" {
                "Win".to_string()
            } else if let Some(k) = part.strip_prefix("Key").filter(|k| k.len() == 1) {
                k.to_string()
            } else if let Some(d) = part.strip_prefix("Digit").filter(|d| d.len() == 1) {
                d.to_string()
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// 「前台全屏时忽略」闸门：非全屏直接放行；全屏时只有在窗口期内连按 3 次才放行（逃生口）。
#[derive(Default)]
pub struct PressGate {
    presses: Vec<Instant>,
}

impl PressGate {
    pub fn allow(&mut self, now: Instant, blocked: bool) -> bool {
        if !blocked {
            self.presses.clear();
            return true;
        }
        self.presses
            .retain(|t| now.saturating_duration_since(*t) <= FORCE_WINDOW);
        self.presses.push(now);
        if self.presses.len() >= FORCE_PRESSES {
            self.presses.clear();
            true
        } else {
            false
        }
    }
}

/// 窗口矩形 (l, t, r, b) 是否覆盖整个显示器矩形
pub fn covers_monitor(window: (i32, i32, i32, i32), monitor: (i32, i32, i32, i32)) -> bool {
    window.0 <= monitor.0 && window.1 <= monitor.1 && window.2 >= monitor.2 && window.3 >= monitor.3
}

#[cfg(windows)]
fn foreground_is_fullscreen() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    };
    // SAFETY：只读查询前台窗口几何，所有输出缓冲为本函数栈上局部变量
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == std::process::id() {
            return false;
        }
        // 桌面与任务栏铺满屏幕但不是「全屏程序」
        let mut buf = [0u16; 64];
        let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
        let class = String::from_utf16_lossy(&buf[..n]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
            return false;
        }
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return false;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return false;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        let m = info.rcMonitor;
        covers_monitor(
            (rect.left, rect.top, rect.right, rect.bottom),
            (m.left, m.top, m.right, m.bottom),
        )
    }
}

#[cfg(not(windows))]
fn foreground_is_fullscreen() -> bool {
    false
}

// ───────────────────────────── 运行期状态 ─────────────────────────────

static LAUNCH_MODE: OnceLock<LaunchMode> = OnceLock::new();

#[derive(Default)]
pub struct DesktopState {
    close_to_tray: AtomicBool,
    ignore_fullscreen: AtomicBool,
    inner: Mutex<DesktopInner>,
}

#[derive(Default)]
struct DesktopInner {
    /// 已由本应用注册成功的快捷键：动作 → (原文, 快捷键 id)
    registered: BTreeMap<HotkeyAction, (String, u32)>,
    /// 设置里保存、但启动时注册失败的原因（例如被其他程序占用）
    startup_errors: BTreeMap<HotkeyAction, String>,
    gate: PressGate,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyInfo {
    pub action: HotkeyAction,
    pub label: &'static str,
    pub accelerator: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub hotkeys: Vec<HotkeyInfo>,
    pub close_action: CloseAction,
    pub ignore_fullscreen: bool,
    pub launch_mode: LaunchMode,
    /// 托盘图标当前是否存在（托盘模式或后台启动时才有）
    pub tray_active: bool,
}

impl DesktopState {
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::SeqCst)
    }

    fn snapshot(&self, app: &AppHandle) -> DesktopSettings {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        DesktopSettings {
            hotkeys: HotkeyAction::ALL
                .into_iter()
                .map(|action| HotkeyInfo {
                    action,
                    label: action.label(),
                    accelerator: inner.registered.get(&action).map(|(a, _)| a.clone()),
                    error: inner.startup_errors.get(&action).cloned(),
                })
                .collect(),
            close_action: if self.close_to_tray() {
                CloseAction::Tray
            } else {
                CloseAction::Exit
            },
            ignore_fullscreen: self.ignore_fullscreen.load(Ordering::SeqCst),
            launch_mode: launch_mode(),
            tray_active: app.tray_by_id(TRAY_ID).is_some(),
        }
    }
}

pub fn launch_mode() -> LaunchMode {
    LAUNCH_MODE.get().copied().unwrap_or(LaunchMode::Show)
}

// ───────────────────────────── 动作分派 ─────────────────────────────

/// 全局快捷键回调：按快捷键 id 查表得到动作，经「全屏忽略」闸门后分派。
pub fn on_shortcut_pressed(app: &AppHandle, shortcut: &Shortcut) {
    let t0_ms = crate::quick::now_ms();
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    let action = {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(action) = inner
            .registered
            .iter()
            .find(|(_, (_, id))| *id == shortcut.id())
            .map(|(a, _)| *a)
        else {
            return;
        };
        let blocked = state.ignore_fullscreen.load(Ordering::SeqCst) && foreground_is_fullscreen();
        if !inner.gate.allow(Instant::now(), blocked) {
            log::info!(
                "[desktop] 前台全屏，忽略热键 {}（2 秒内连按 3 次可强制）",
                action.id()
            );
            return;
        }
        action
    };
    match action {
        HotkeyAction::ToggleMain => toggle_main_window(app),
        HotkeyAction::OpenQuick => crate::quick::toggle(app, t0_ms),
        HotkeyAction::CollectSelection => collect_selection(app),
    }
}

/// 热键 B：先取前台窗口（之后弹窗会改变前台），在 STA 线程里读资源管理器选中项；
/// 读不到（前台不是资源管理器、没有选中、权限不同）时改收剪贴板里的文件；都没有则提示音。
pub fn collect_selection(app: &AppHandle) {
    let foreground = crate::explorer_selection::foreground_window();
    let app = app.clone();
    let _ = std::thread::Builder::new()
        .name("tl-collect-selection".into())
        .spawn(move || {
            let mut paths =
                crate::explorer_selection::selection_of(foreground).unwrap_or_else(|e| {
                    log::warn!("[desktop] {e}");
                    Vec::new()
                });
            let mut source = "explorer";
            if paths.is_empty() {
                paths = crate::shell_clipboard::read_clipboard_candidates();
                source = "clipboard";
            }
            if crate::collect::submit_now(&app, paths).is_none() {
                log::info!("[desktop] 收纳热键：前台没有资源管理器选中项，剪贴板里也没有文件");
                beep();
            } else {
                log::info!("[desktop] 收纳热键：来源 {source}");
            }
        });
}

fn beep() {
    #[cfg(windows)]
    // SAFETY：无指针参数
    unsafe {
        windows_sys::Win32::System::Diagnostics::Debug::MessageBeep(
            windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONWARNING,
        );
    }
}

/// 唤起/收起主窗口：可见且有焦点时收起（托盘模式隐藏，否则最小化），其余情况显示并聚焦。
pub fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && !minimized && focused {
        let to_tray = app
            .try_state::<DesktopState>()
            .is_some_and(|s| s.close_to_tray())
            || app.tray_by_id(TRAY_ID).is_some();
        if to_tray {
            let _ = window.hide();
        } else {
            let _ = window.minimize();
        }
    } else {
        show_main_window(app);
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // 唤出即检测外部写入：隐藏期间检测间隔较长，唤出时不等下一轮
    crate::data_sync::poke();
}

/// 单实例回调：第二次启动转发来的参数（含 exe 本身）按参数路由处理。
pub fn handle_second_instance(app: &AppHandle, args: &[String]) {
    // 右键菜单 / 发送到：每项一进程转发过来，交给收纳会话合并
    if let Some(paths) = crate::collect::collect_args(args.iter().skip(1)) {
        crate::collect::submit(app, paths);
        return;
    }
    match parse_launch_args(args.iter().skip(1)) {
        LaunchMode::Show => show_main_window(app),
        // 已在运行：后台启动请求不打扰用户，只确认托盘可用
        LaunchMode::Background => sync_tray(app),
    }
}

// ───────────────────────────── 托盘（由数据模型生成） ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayEntry {
    Item { id: &'static str, label: String },
    Separator,
}

/// 托盘菜单模型：由设置生成，设置变化即重建。以后加「快速搜索」「右键菜单：已开启」等项在此扩展。
pub fn tray_menu_model(settings: &DesktopSettings) -> Vec<TrayEntry> {
    let toggle = accelerator_of(settings, HotkeyAction::ToggleMain);
    let show_label = match toggle {
        Some(acc) => format!("显示 TagLauncher（{}）", display_accelerator(acc)),
        None => "显示 TagLauncher".to_string(),
    };
    let mut model = vec![TrayEntry::Item {
        id: MENU_SHOW,
        label: show_label,
    }];
    // 快速搜索窗开启（已绑定快捷键）时才出现
    if let Some(acc) = accelerator_of(settings, HotkeyAction::OpenQuick) {
        model.push(TrayEntry::Item {
            id: MENU_QUICK,
            label: format!("快速搜索（{}）", display_accelerator(acc)),
        });
    }
    model.extend([
        TrayEntry::Separator,
        TrayEntry::Item {
            id: MENU_QUIT,
            label: "退出".to_string(),
        },
    ]);
    model
}

fn accelerator_of(settings: &DesktopSettings, action: HotkeyAction) -> Option<&str> {
    settings
        .hotkeys
        .iter()
        .find(|h| h.action == action)
        .and_then(|h| h.accelerator.as_deref())
}

/// 是否需要托盘：关闭到托盘，或后台启动（否则没有入口唤回主窗）
fn tray_needed(app: &AppHandle) -> bool {
    launch_mode() == LaunchMode::Background
        || app
            .try_state::<DesktopState>()
            .is_some_and(|s| s.close_to_tray())
}

fn build_menu(app: &AppHandle, model: &[TrayEntry]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for entry in model {
        match entry {
            TrayEntry::Item { id, label } => {
                menu.append(&MenuItem::with_id(app, *id, label, true, None::<&str>)?)?
            }
            TrayEntry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(menu)
}

fn create_tray(app: &AppHandle, menu: &Menu<tauri::Wry>) -> Result<(), String> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("TagLauncher")
        .menu(menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUICK => crate::quick::toggle(app, crate::quick::now_ms()),
            // 真正退出：走正常退出流程（RunEvent::Exit 里的清理照常执行）
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .build(app)
        .map(|_| ())
        .map_err(|e| format!("创建托盘图标失败：{e}"))
}

/// 按当前设置建立/重建/移除托盘，并广播设置变化。
fn sync_tray(app: &AppHandle) {
    if let Err(e) = try_sync_tray(app) {
        log::warn!("[desktop] {e}");
    }
    if let Some(state) = app.try_state::<DesktopState>() {
        let _ = app.emit(SETTINGS_CHANGED_EVENT, state.snapshot(app));
    }
}

fn try_sync_tray(app: &AppHandle) -> Result<(), String> {
    if !tray_needed(app) {
        if let Some(tray) = app.remove_tray_by_id(TRAY_ID) {
            let _ = tray.set_visible(false);
        }
        return Ok(());
    }
    let Some(state) = app.try_state::<DesktopState>() else {
        return Ok(());
    };
    let model = tray_menu_model(&state.snapshot(app));
    let menu = build_menu(app, &model).map_err(|e| format!("生成托盘菜单失败：{e}"))?;
    match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray
            .set_menu(Some(menu))
            .map_err(|e| format!("更新托盘菜单失败：{e}")),
        None => create_tray(app, &menu),
    }
}

// ───────────────────────────── 注册 / 启动恢复 ─────────────────────────────

fn register(app: &AppHandle, text: &str) -> Result<u32, String> {
    let (_, shortcut) = parse_user_shortcut(text)?;
    app.global_shortcut()
        .register(shortcut)
        .map(|_| shortcut.id())
        .map_err(|e| format!("无法注册全局快捷键「{text}」，可能已被其他程序占用（{e}）"))
}

fn unregister(app: &AppHandle, text: &str) {
    if let Ok((_, shortcut)) = parse_user_shortcut(text) {
        if let Err(e) = app.global_shortcut().unregister(shortcut) {
            log::warn!("[desktop] 注销全局快捷键 {text} 失败：{e}");
        }
    }
}

/// 启动时按设置恢复。注册失败只记录原因（设置页可见），不阻断启动、不改用户设置。
pub fn init(app: &AppHandle, mode: LaunchMode) {
    let _ = LAUNCH_MODE.set(mode);
    let state = DesktopState::default();
    let (hotkeys, close_action, ignore_fullscreen) = {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        let hotkeys: Vec<(HotkeyAction, String)> = HotkeyAction::ALL
            .into_iter()
            .filter_map(|a| {
                settings_service::get_setting(&conn, &a.setting_key())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| (a, s))
            })
            .collect();
        (
            hotkeys,
            CloseAction::from_setting(
                settings_service::get_setting(&conn, CLOSE_ACTION_KEY).as_deref(),
            ),
            // 默认开：只有显式 "0" 才关闭
            settings_service::get_setting(&conn, IGNORE_FULLSCREEN_KEY).as_deref() != Some("0"),
        )
    };
    state
        .close_to_tray
        .store(close_action == CloseAction::Tray, Ordering::SeqCst);
    state
        .ignore_fullscreen
        .store(ignore_fullscreen, Ordering::SeqCst);
    {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        for (action, text) in hotkeys {
            match register(app, &text) {
                Ok(id) => {
                    inner.registered.insert(action, (text, id));
                }
                Err(e) => {
                    log::warn!("[desktop] {e}");
                    inner.startup_errors.insert(action, e);
                }
            }
        }
    }
    let quick_enabled = state
        .inner
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .registered
        .contains_key(&HotkeyAction::OpenQuick);
    app.manage(state);
    sync_tray(app);
    crate::quick::sync_window(app, quick_enabled);
}

/// 快速搜索窗是否开启（「打开快速搜索窗」已绑定快捷键）
pub fn quick_enabled(app: &AppHandle) -> bool {
    app.try_state::<DesktopState>().is_some_and(|s| {
        s.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .registered
            .contains_key(&HotkeyAction::OpenQuick)
    })
}

// ───────────────────────────── 命令 ─────────────────────────────

#[tauri::command]
pub fn get_desktop_settings(app: AppHandle) -> DesktopSettings {
    app.state::<DesktopState>().snapshot(&app)
}

/// 窗口刚被前端显示（启动时主题就绪后的 show）：立即检测一次外部写入。
/// 没有焦点的显示不会触发 Focused 事件，隐藏期的检测间隔又较长，冷路径靠这里补上。
#[tauri::command]
pub fn wake_data_sync() {
    crate::data_sync::poke();
}

/// 首个实例的启动方式：前端据此决定主题就绪后是否显示主窗（后台启动不显示）。
#[tauri::command]
pub fn get_launch_mode() -> LaunchMode {
    launch_mode()
}

/// 设置或清除（None）某个动作的全局快捷键。先注销旧键再注册新键；新键注册失败（冲突/占用）
/// 或保存失败时重新注册旧键并返回错误，设置保持旧值。同一组合不能绑给两个动作。
/// async：注册需派发到主线程，不能在主线程上同步等待。
#[tauri::command]
pub async fn set_hotkey(
    app: AppHandle,
    action: String,
    shortcut: Option<String>,
) -> Result<DesktopSettings, String> {
    crate::db::ensure_writes_allowed()?;
    let action = HotkeyAction::parse(action.trim())?;
    let next = match shortcut.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(text) => Some(parse_user_shortcut(text)?),
        None => None,
    };
    let state = app.state::<DesktopState>();
    {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let previous = inner.registered.get(&action).cloned();
        if previous.as_ref().map(|(_, id)| *id) == next.as_ref().map(|(_, s)| s.id()) {
            inner.startup_errors.remove(&action);
        } else {
            if let Some((text, shortcut)) = &next {
                if let Some((other, _)) = inner
                    .registered
                    .iter()
                    .find(|(a, (_, id))| **a != action && *id == shortcut.id())
                {
                    return Err(format!(
                        "「{text}」已用于「{}」，请换一个组合",
                        other.label()
                    ));
                }
            }
            if let Some((old, _)) = &previous {
                unregister(&app, old);
            }
            let rollback = |app: &AppHandle| -> Option<(String, u32)> {
                let (old, _) = previous.as_ref()?;
                match register(app, old) {
                    Ok(id) => Some((old.clone(), id)),
                    Err(e) => {
                        log::warn!("[desktop] 回滚旧快捷键失败：{e}");
                        None
                    }
                }
            };
            let restore = |inner: &mut DesktopInner, restored: Option<(String, u32)>| match restored
            {
                Some(entry) => {
                    inner.registered.insert(action, entry);
                }
                None => {
                    inner.registered.remove(&action);
                }
            };
            let mut new_entry = None;
            if let Some((text, _)) = &next {
                match register(&app, text) {
                    Ok(id) => new_entry = Some((text.clone(), id)),
                    Err(e) => {
                        let restored = rollback(&app);
                        restore(&mut *inner, restored);
                        let kept = previous
                            .as_ref()
                            .map(|(p, _)| format!("，已保留原快捷键「{p}」"))
                            .unwrap_or_else(|| "，该快捷键保持未启用".to_string());
                        return Err(format!("{e}{kept}"));
                    }
                }
            }
            let saved = {
                let db = app.state::<Database>();
                let conn = db.get_conn();
                settings_service::set_setting(
                    &conn,
                    &action.setting_key(),
                    new_entry.as_ref().map(|(t, _)| t.as_str()).unwrap_or(""),
                )
            };
            if let Err(e) = saved {
                if let Some((text, _)) = &new_entry {
                    unregister(&app, text);
                }
                let restored = rollback(&app);
                restore(&mut *inner, restored);
                return Err(format!("保存快捷键失败：{e}"));
            }
            restore(&mut *inner, new_entry);
            inner.startup_errors.remove(&action);
        }
    }
    if action == HotkeyAction::OpenQuick {
        crate::quick::sync_window(&app, quick_enabled(&app));
    }
    sync_tray(&app);
    Ok(state.snapshot(&app))
}

/// 设置关闭窗口行为。切到托盘时托盘随之建立；建立失败则不保存、保持旧值。
#[tauri::command]
pub fn set_close_action(app: AppHandle, action: String) -> Result<DesktopSettings, String> {
    crate::db::ensure_writes_allowed()?;
    let action = CloseAction::parse(action.trim())?;
    let state = app.state::<DesktopState>();
    let previous = state.close_to_tray();
    state
        .close_to_tray
        .store(action == CloseAction::Tray, Ordering::SeqCst);
    if let Err(e) = try_sync_tray(&app) {
        state.close_to_tray.store(previous, Ordering::SeqCst);
        let _ = try_sync_tray(&app);
        return Err(e);
    }
    let saved = {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        settings_service::set_setting(&conn, CLOSE_ACTION_KEY, action.as_str())
    };
    if let Err(e) = saved {
        state.close_to_tray.store(previous, Ordering::SeqCst);
        sync_tray(&app);
        return Err(format!("保存关闭行为失败：{e}"));
    }
    sync_tray(&app);
    Ok(state.snapshot(&app))
}

/// 前台全屏时忽略全局快捷键（默认开；2 秒内连按 3 次仍可强制）。
#[tauri::command]
pub fn set_hotkey_ignore_fullscreen(
    app: AppHandle,
    enabled: bool,
) -> Result<DesktopSettings, String> {
    crate::db::ensure_writes_allowed()?;
    {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        settings_service::set_setting(
            &conn,
            IGNORE_FULLSCREEN_KEY,
            if enabled { "1" } else { "0" },
        )?;
    }
    let state = app.state::<DesktopState>();
    state.ignore_fullscreen.store(enabled, Ordering::SeqCst);
    sync_tray(&app);
    Ok(state.snapshot(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_action_defaults_to_exit_and_rejects_unknown() {
        assert_eq!(CloseAction::from_setting(None), CloseAction::Exit);
        assert_eq!(
            CloseAction::from_setting(Some("garbage")),
            CloseAction::Exit
        );
        assert_eq!(CloseAction::from_setting(Some("tray")), CloseAction::Tray);
        assert!(CloseAction::parse("minimize").is_err());
        assert_eq!(CloseAction::parse("tray").unwrap().as_str(), "tray");
    }

    #[test]
    fn hotkey_actions_use_action_named_setting_keys() {
        assert_eq!(HotkeyAction::ToggleMain.setting_key(), "hotkey.toggle_main");
        assert_eq!(
            HotkeyAction::parse("toggle_main").unwrap(),
            HotkeyAction::ToggleMain
        );
        assert_eq!(
            HotkeyAction::parse("open_quick").unwrap(),
            HotkeyAction::OpenQuick
        );
        assert_eq!(HotkeyAction::OpenQuick.setting_key(), "hotkey.open_quick");
        assert!(
            HotkeyAction::parse("quick_search").is_err(),
            "未开放的动作一律拒绝"
        );
    }

    #[test]
    fn shortcut_requires_ctrl_alt_or_win() {
        assert!(parse_user_shortcut("Ctrl+Alt+KeyK").is_ok());
        assert!(parse_user_shortcut("Alt+Space").is_ok());
        assert!(parse_user_shortcut("Super+Digit1").is_ok());
        assert!(parse_user_shortcut("KeyK").is_err(), "单键会拦截日常输入");
        assert!(
            parse_user_shortcut("Shift+KeyK").is_err(),
            "只加 Shift 会拦截大写输入"
        );
        assert!(parse_user_shortcut("   ").is_err());
        assert!(parse_user_shortcut("Ctrl+NotAKey").is_err());
        assert_eq!(parse_user_shortcut("  Ctrl+KeyK ").unwrap().0, "Ctrl+KeyK");
    }

    #[test]
    fn launch_args_route_show_and_background() {
        assert_eq!(parse_launch_args(Vec::<String>::new()), LaunchMode::Show);
        assert_eq!(parse_launch_args(["--background"]), LaunchMode::Background);
        assert_eq!(
            parse_launch_args(["--background", "--show"]),
            LaunchMode::Show
        );
        assert_eq!(
            parse_launch_args(["D:\\a b.txt", "--collect", "--background"]),
            LaunchMode::Background,
            "未知参数只当数据忽略"
        );
        // --collect 之后都是路径：其后的 --show 不算开关；之前显式 --show 才显示主窗
        assert_eq!(
            parse_launch_args(["--collect", "--show"]),
            LaunchMode::Background
        );
        assert_eq!(
            parse_launch_args(["--show", "--collect", "D:\\a.txt"]),
            LaunchMode::Show
        );
    }

    #[test]
    fn fullscreen_gate_ignores_until_three_quick_presses() {
        let mut gate = PressGate::default();
        let t0 = Instant::now();
        assert!(gate.allow(t0, false), "非全屏直接放行");
        assert!(!gate.allow(t0, true));
        assert!(!gate.allow(t0 + Duration::from_millis(500), true));
        assert!(
            gate.allow(t0 + Duration::from_millis(900), true),
            "2 秒内第 3 次强制"
        );
        assert!(!gate.allow(t0 + Duration::from_secs(5), true), "计数已清零");
        assert!(
            !gate.allow(t0 + Duration::from_secs(8), true),
            "超出窗口期不累计"
        );
        assert!(!gate.allow(t0 + Duration::from_millis(8500), true));
        assert!(gate.allow(t0 + Duration::from_millis(9000), true));
    }

    #[test]
    fn covers_monitor_detects_fullscreen_geometry() {
        assert!(covers_monitor((0, 0, 1920, 1080), (0, 0, 1920, 1080)));
        assert!(
            covers_monitor((-8, -8, 1928, 1088), (0, 0, 1920, 1080)),
            "无边框最大化溢出也算"
        );
        assert!(
            !covers_monitor((0, 0, 1920, 1040), (0, 0, 1920, 1080)),
            "留出任务栏不算全屏"
        );
    }

    #[test]
    fn display_accelerator_is_readable() {
        assert_eq!(display_accelerator("Ctrl+Alt+KeyK"), "Ctrl+Alt+K");
        assert_eq!(display_accelerator("Super+Digit1"), "Win+1");
        assert_eq!(display_accelerator("Ctrl+Shift+F9"), "Ctrl+Shift+F9");
    }

    fn settings_with(accelerator: Option<&str>) -> DesktopSettings {
        settings_with_quick(accelerator, None)
    }

    fn settings_with_quick(accelerator: Option<&str>, quick: Option<&str>) -> DesktopSettings {
        DesktopSettings {
            hotkeys: [
                (HotkeyAction::ToggleMain, accelerator),
                (HotkeyAction::OpenQuick, quick),
            ]
            .into_iter()
            .map(|(action, acc)| HotkeyInfo {
                action,
                label: action.label(),
                accelerator: acc.map(str::to_string),
                error: None,
            })
            .collect(),
            close_action: CloseAction::Tray,
            ignore_fullscreen: true,
            launch_mode: LaunchMode::Show,
            tray_active: true,
        }
    }

    #[test]
    fn tray_menu_is_generated_from_settings() {
        let plain = tray_menu_model(&settings_with(None));
        assert_eq!(
            plain,
            vec![
                TrayEntry::Item {
                    id: MENU_SHOW,
                    label: "显示 TagLauncher".into()
                },
                TrayEntry::Separator,
                TrayEntry::Item {
                    id: MENU_QUIT,
                    label: "退出".into()
                },
            ]
        );
        let with_key = tray_menu_model(&settings_with(Some("Ctrl+Alt+KeyK")));
        assert_eq!(
            with_key[0],
            TrayEntry::Item {
                id: MENU_SHOW,
                label: "显示 TagLauncher（Ctrl+Alt+K）".into()
            }
        );
    }

    #[test]
    fn tray_menu_lists_quick_search_only_when_bound() {
        let model = tray_menu_model(&settings_with_quick(None, Some("Alt+Space")));
        assert_eq!(
            model,
            vec![
                TrayEntry::Item {
                    id: MENU_SHOW,
                    label: "显示 TagLauncher".into()
                },
                TrayEntry::Item {
                    id: MENU_QUICK,
                    label: "快速搜索（Alt+Space）".into()
                },
                TrayEntry::Separator,
                TrayEntry::Item {
                    id: MENU_QUIT,
                    label: "退出".into()
                },
            ]
        );
        assert!(!tray_menu_model(&settings_with(None))
            .iter()
            .any(|e| matches!(e, TrayEntry::Item { id, .. } if *id == MENU_QUICK)));
    }

    #[test]
    fn quick_action_is_listed_after_toggle_main_and_unbound_by_default() {
        assert_eq!(
            HotkeyAction::ALL,
            [
                HotkeyAction::ToggleMain,
                HotkeyAction::OpenQuick,
                HotkeyAction::CollectSelection
            ]
        );
        assert_eq!(HotkeyAction::OpenQuick.label(), "打开快速搜索窗");
    }

    #[test]
    fn collect_selection_action_has_its_own_setting_key() {
        assert_eq!(
            HotkeyAction::parse("collect_selection").unwrap(),
            HotkeyAction::CollectSelection
        );
        assert_eq!(
            HotkeyAction::CollectSelection.setting_key(),
            "hotkey.collect_selection"
        );
        assert_eq!(HotkeyAction::CollectSelection.label(), "收纳资源管理器选中项");
        // 托盘菜单只列显示主窗与快速搜索：绑定收纳热键不增加托盘项
        let mut settings = settings_with(Some("Ctrl+Alt+KeyK"));
        settings.hotkeys.push(HotkeyInfo {
            action: HotkeyAction::CollectSelection,
            label: HotkeyAction::CollectSelection.label(),
            accelerator: Some("Ctrl+Alt+KeyC".into()),
            error: None,
        });
        assert_eq!(tray_menu_model(&settings).len(), 3);
    }
}

/// 见 lib.rs `run()`：第二个实例把前台权让出，首个实例弹快速窗 / 唤主窗时能拿到前台。
pub fn allow_foreground_handoff() {
    #[cfg(windows)]
    // SAFETY: 无参数指针；ASFW_ANY 允许任意进程下一次 SetForegroundWindow，失败只是没有前台权。
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(
            windows_sys::Win32::UI::WindowsAndMessaging::ASFW_ANY,
        );
    }
}

//! 桌面驻留（F18）：托盘、可配置全局唤起快捷键、关闭窗口行为。
//!
//! 默认值保持旧行为：不注册任何全局快捷键、关闭窗口即退出、不建托盘、不开机自启。
//! 设置保存在 app_meta（`desktop.*` 键只能走本模块的专用命令写入）。
//! 全局快捷键只在 Rust 侧注册（tauri-plugin-global-shortcut），不向前端开放插件权限。

use crate::db::Database;
use crate::services::settings_service;
use serde::Serialize;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

pub const SHORTCUT_KEY: &str = "desktop.global_shortcut";
pub const CLOSE_ACTION_KEY: &str = "desktop.close_action";
pub const TRAY_ID: &str = "taglauncher-tray";
const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";

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

/// 运行期状态：当前已注册的快捷键、关闭行为、启动时注册失败的原因。
#[derive(Default)]
pub struct DesktopState {
    close_to_tray: AtomicBool,
    inner: Mutex<DesktopInner>,
}

#[derive(Default)]
struct DesktopInner {
    /// 当前由本应用注册成功的快捷键原文（None = 未启用）
    registered: Option<String>,
    /// 设置里保存、但启动时注册失败的快捷键与原因（例如被其他程序占用）
    startup_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub global_shortcut: Option<String>,
    pub close_action: CloseAction,
    pub shortcut_error: Option<String>,
}

impl DesktopState {
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::SeqCst)
    }

    fn snapshot(&self) -> DesktopSettings {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        DesktopSettings {
            global_shortcut: inner.registered.clone(),
            close_action: if self.close_to_tray() {
                CloseAction::Tray
            } else {
                CloseAction::Exit
            },
            shortcut_error: inner.startup_error.clone(),
        }
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
            .is_some_and(|s| s.close_to_tray());
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
}

fn ensure_tray(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(app, MENU_SHOW, "显示 TagLauncher", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit =
        MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|e| e.to_string())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("TagLauncher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
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

fn remove_tray(app: &AppHandle) {
    if let Some(tray) = app.remove_tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
}

fn register(app: &AppHandle, text: &str) -> Result<(), String> {
    let (_, shortcut) = parse_user_shortcut(text)?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("无法注册全局快捷键「{text}」，可能已被其他程序占用（{e}）"))
}

fn unregister(app: &AppHandle, text: &str) {
    if let Ok((_, shortcut)) = parse_user_shortcut(text) {
        if let Err(e) = app.global_shortcut().unregister(shortcut) {
            log::warn!("[desktop] 注销全局快捷键 {text} 失败：{e}");
        }
    }
}

/// 启动时按设置恢复：注册失败只记录原因（设置页可见），不阻断启动、不改用户设置。
pub fn init(app: &AppHandle) {
    let state = DesktopState::default();
    let (shortcut, close_action) = {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        (
            settings_service::get_setting(&conn, SHORTCUT_KEY).filter(|s| !s.trim().is_empty()),
            CloseAction::from_setting(
                settings_service::get_setting(&conn, CLOSE_ACTION_KEY).as_deref(),
            ),
        )
    };
    if close_action == CloseAction::Tray {
        match ensure_tray(app) {
            Ok(()) => state.close_to_tray.store(true, Ordering::SeqCst),
            Err(e) => log::warn!("[desktop] {e}；关闭窗口将按退出处理"),
        }
    }
    if let Some(text) = shortcut {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        match register(app, &text) {
            Ok(()) => inner.registered = Some(text),
            Err(e) => {
                log::warn!("[desktop] {e}");
                inner.startup_error = Some(e);
            }
        }
    }
    app.manage(state);
}

#[tauri::command]
pub fn get_desktop_settings(app: AppHandle) -> DesktopSettings {
    app.state::<DesktopState>().snapshot()
}

/// 设置或清除全局快捷键。先注销旧键再注册新键；新键注册失败（冲突/占用）或保存失败时
/// 重新注册旧键并返回错误，设置保持旧值。async：注册需派发到主线程，不能在主线程上同步等待。
#[tauri::command]
pub async fn set_global_shortcut(
    app: AppHandle,
    shortcut: Option<String>,
) -> Result<DesktopSettings, String> {
    crate::db::ensure_writes_allowed()?;
    let next = match shortcut.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(text) => Some(parse_user_shortcut(text)?.0),
        None => None,
    };
    let state = app.state::<DesktopState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let previous = inner.registered.clone();
    if previous == next {
        inner.startup_error = None;
        drop(inner);
        return Ok(state.snapshot());
    }
    if let Some(old) = &previous {
        unregister(&app, old);
    }
    let rollback = |app: &AppHandle| {
        if let Some(old) = &previous {
            if let Err(e) = register(app, old) {
                log::warn!("[desktop] 回滚旧快捷键失败：{e}");
            }
        }
    };
    if let Some(text) = &next {
        if let Err(e) = register(&app, text) {
            rollback(&app);
            let kept = previous
                .as_deref()
                .map(|p| format!("，已保留原快捷键「{p}」"))
                .unwrap_or_else(|| "，全局快捷键保持未启用".to_string());
            return Err(format!("{e}{kept}"));
        }
    }
    let saved = {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        settings_service::set_setting(&conn, SHORTCUT_KEY, next.as_deref().unwrap_or(""))
    };
    if let Err(e) = saved {
        if let Some(text) = &next {
            unregister(&app, text);
        }
        rollback(&app);
        return Err(format!("保存快捷键失败：{e}"));
    }
    inner.registered = next;
    inner.startup_error = None;
    drop(inner);
    Ok(state.snapshot())
}

/// 设置关闭窗口行为。切到托盘时先建托盘，失败则不保存；切回退出时移除托盘。
#[tauri::command]
pub fn set_close_action(app: AppHandle, action: String) -> Result<DesktopSettings, String> {
    crate::db::ensure_writes_allowed()?;
    let action = CloseAction::parse(action.trim())?;
    if action == CloseAction::Tray {
        ensure_tray(&app)?;
    }
    let saved = {
        let db = app.state::<Database>();
        let conn = db.get_conn();
        settings_service::set_setting(&conn, CLOSE_ACTION_KEY, action.as_str())
    };
    if let Err(e) = saved {
        if action == CloseAction::Tray && !app.state::<DesktopState>().close_to_tray() {
            remove_tray(&app);
        }
        return Err(format!("保存关闭行为失败：{e}"));
    }
    let state = app.state::<DesktopState>();
    state
        .close_to_tray
        .store(action == CloseAction::Tray, Ordering::SeqCst);
    if action == CloseAction::Exit {
        remove_tray(&app);
    }
    Ok(state.snapshot())
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
}

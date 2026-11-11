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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickShown {
    /// 唤出请求时刻（Unix 毫秒）：热键回调或 quick_open 调用时
    pub t0_ms: u64,
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
    let window = WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("quick.html".into()))
        .title("TagLauncher 快速搜索")
        .inner_size(QUICK_WIDTH, QUICK_HEIGHT)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("创建快速搜索窗失败：{e}"))?;
    // 失焦自动隐藏（Esc / 打开对象 / 点到别处都应收起）
    let w = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = w.hide();
        }
    });
    Ok(window)
}

pub fn destroy_window(app: &AppHandle) {
    if let Some(w) = quick_window(app) {
        let _ = w.destroy();
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

/// 把快速窗放到鼠标所在显示器（取不到则主窗所在显示器）的工作区。
fn place_on_cursor_monitor(app: &AppHandle, window: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
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
    place_on_cursor_monitor(app, &window);
    window.show().map_err(|e| e.to_string())?;
    // 快速窗可见期间按可见间隔检测外部写入，唤出时先检测一次
    crate::data_sync::poke();
    if activate {
        let _ = window.set_focus();
    }
    let _ = window.emit(QUICK_SHOWN_EVENT, QuickShown { t0_ms });
    Ok(())
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = quick_window(app) {
        let _ = w.hide();
    }
}

/// 热键：可见且有焦点 → 收起；否则唤出。
pub fn toggle(app: &AppHandle, t0_ms: u64) {
    if let Some(w) = quick_window(app) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
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

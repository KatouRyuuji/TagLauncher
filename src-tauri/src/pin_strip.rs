//! 边缘抽屉收起时的把手：一个原生的细条窗口（无 WebView）。
//!
//! 为什么不用 WebView 窗口缩成细条：WebView2 视口有最小宽度（CI 实测 4px 窗口里 innerWidth=12），
//! 极窄的 WebView 收不到可靠的悬停事件，CDP 挂接也不稳定。原生细条用 TrackMouseEvent(TME_HOVER)
//! 由系统判定「停留」，不轮询、不装输入钩子；收起时 quick 窗口整个隐藏，WebView 不画也不占 CPU。
//! 窗口：WS_POPUP + TOOLWINDOW（不进任务栏 / Alt+Tab）+ TOPMOST + NOACTIVATE（点了也不抢焦点）+
//! LAYERED（半透明）。颜色取主题强调色（前端经 `pin_handle_color` 告知），未告知时用系统高亮色。
//! 只在主线程创建；之后的显示 / 移动 / 隐藏可在任意线程调用（SetWindowPos 跨线程是同步消息）。

use crate::pin::Rect;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

/// 停留多久算「碰边停住」（与前端 PIN_HOVER_EXPAND_MS 一致）
pub const HOVER: Duration = Duration::from_millis(120);
const TITLE: &str = "TagLauncher 钉住把手";
const ALPHA: u8 = 170;

struct Strip {
    hwnd: isize,
    creating: bool,
    visible: bool,
    rect: Rect,
    color: Option<u32>,
}

static STRIP: Mutex<Strip> = Mutex::new(Strip {
    hwnd: 0,
    creating: false,
    visible: false,
    rect: (0, 0, 0, 0),
    color: None,
});
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

fn lock() -> std::sync::MutexGuard<'static, Strip> {
    STRIP.lock().unwrap_or_else(|e| e.into_inner())
}

/// 把手当前状态（诊断 / E2E）：是否显示与物理矩形
pub fn state() -> (bool, Rect) {
    let s = lock();
    (s.hwnd != 0 && s.visible, s.rect)
}

/// 在 rect（物理像素）处显示把手
pub fn show(app: &AppHandle, rect: Rect) {
    {
        let mut s = lock();
        s.visible = true;
        s.rect = rect;
    }
    apply(app);
}

pub fn hide(app: &AppHandle) {
    lock().visible = false;
    apply(app);
}

/// 前端告知主题强调色（"#rrggbb" / "rgb(r, g, b)"）；解析失败忽略
pub fn set_color(app: &AppHandle, css: &str) {
    let Some(rgb) = parse_css_color(css) else {
        return;
    };
    {
        let mut s = lock();
        if s.color == Some(rgb) {
            return;
        }
        s.color = Some(rgb);
    }
    apply(app);
}

/// 解析 CSS 颜色为 0x00BBGGRR（COLORREF）
pub fn parse_css_color(css: &str) -> Option<u32> {
    let c = css.trim();
    let (r, g, b) = if let Some(hex) = c.strip_prefix('#') {
        let hex = hex.trim();
        let full: String = match hex.len() {
            3 | 4 => hex.chars().take(3).flat_map(|ch| [ch, ch]).collect(),
            6 | 8 => hex[..6].to_string(),
            _ => return None,
        };
        let v = u32::from_str_radix(&full, 16).ok()?;
        ((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
    } else if let Some(body) = c.strip_prefix("rgb(").or_else(|| c.strip_prefix("rgba(")) {
        let body = body.trim_end_matches(')');
        let parts: Vec<u32> = body
            .split([',', ' ', '/'])
            .filter(|p| !p.is_empty())
            .take(3)
            .map(|p| {
                p.trim()
                    .parse::<f64>()
                    .ok()
                    .map(|v| v.clamp(0.0, 255.0).round() as u32)
            })
            .collect::<Option<Vec<_>>>()?;
        if parts.len() != 3 {
            return None;
        }
        (parts[0], parts[1], parts[2])
    } else {
        return None;
    };
    Some(r | (g << 8) | (b << 16))
}

#[cfg(windows)]
fn apply(app: &AppHandle) {
    let (hwnd, creating) = {
        let s = lock();
        (s.hwnd, s.creating)
    };
    if hwnd == 0 {
        if creating || !lock().visible {
            return;
        }
        lock().creating = true;
        let _ = APP.set(app.clone());
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let h = win::create();
            {
                let mut s = lock();
                s.hwnd = h;
                s.creating = false;
            }
            if h != 0 {
                apply(&handle);
            }
        });
        return;
    }
    win::sync(hwnd);
}

#[cfg(not(windows))]
fn apply(_app: &AppHandle) {}

#[cfg(windows)]
mod win {
    use super::*;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, GetSysColor,
        InvalidateRect, COLOR_HIGHLIGHT, PAINTSTRUCT,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_HOVER, TRACKMOUSEEVENT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetClientRect, LoadCursorW, RegisterClassW,
        SetLayeredWindowAttributes, SetWindowPos, ShowWindow, HWND_TOPMOST, IDC_HAND, LWA_ALPHA,
        MA_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WM_LBUTTONDOWN, WM_MOUSEACTIVATE,
        WM_MOUSEMOVE, WM_PAINT, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_POPUP,
    };

    /// winuser.h（windows-sys 把它放在 UI_Controls 特性里）
    const WM_MOUSEHOVER: u32 = 0x02A1;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 主线程：注册类并建窗口（初始隐藏）。失败返回 0。
    pub fn create() -> isize {
        let class = wide("TagLauncherPinStrip");
        let title = wide(TITLE);
        // SAFETY：标准 Win32 窗口创建；字符串缓冲在调用期间有效
        unsafe {
            let hinst = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(proc_),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: hinst,
                hIcon: std::ptr::null_mut(),
                hCursor: LoadCursorW(std::ptr::null_mut(), IDC_HAND),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class.as_ptr(),
            };
            RegisterClassW(&wc); // 已注册时失败无妨
            let h = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_LAYERED,
                class.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                0,
                0,
                1,
                1,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                std::ptr::null(),
            );
            if h.is_null() {
                log::warn!("[pin] 创建抽屉把手窗口失败");
                return 0;
            }
            SetLayeredWindowAttributes(h, 0, ALPHA, LWA_ALPHA);
            h as isize
        }
    }

    /// 按期望状态显示 / 隐藏 / 移动 / 重绘
    pub fn sync(hwnd: isize) {
        let (visible, r) = {
            let s = lock();
            (s.visible, s.rect)
        };
        let h = hwnd as HWND;
        // SAFETY：h 是本进程建的把手窗口
        unsafe {
            if visible {
                SetWindowPos(
                    h,
                    HWND_TOPMOST,
                    r.0,
                    r.1,
                    r.2 as i32,
                    r.3 as i32,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
                InvalidateRect(h, std::ptr::null(), 1);
            } else {
                ShowWindow(h, SW_HIDE);
            }
        }
    }

    unsafe extern "system" fn proc_(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            WM_MOUSEMOVE => {
                let mut t = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_HOVER,
                    hwndTrack: hwnd,
                    dwHoverTime: HOVER.as_millis() as u32,
                };
                TrackMouseEvent(&mut t);
                0
            }
            WM_MOUSEHOVER | WM_LBUTTONDOWN => {
                if let Some(app) = APP.get() {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = crate::pin::expand(&app);
                    });
                }
                0
            }
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let dc = BeginPaint(hwnd, &mut ps);
                let color = lock().color.unwrap_or_else(|| GetSysColor(COLOR_HIGHLIGHT));
                let brush = CreateSolidBrush(color);
                let mut rc: RECT = std::mem::zeroed();
                GetClientRect(hwnd, &mut rc);
                FillRect(dc, &rc, brush);
                DeleteObject(brush as _);
                EndPaint(hwnd, &ps);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_theme_colors_to_colorref() {
        assert_eq!(parse_css_color("#c0647d"), Some(0x7d64c0));
        assert_eq!(parse_css_color(" #abc "), Some(0xccbbaa));
        assert_eq!(parse_css_color("rgb(192, 100, 125)"), Some(0x7d64c0));
        assert_eq!(parse_css_color("rgba(1 2 3 / 0.5)"), Some(0x030201));
        assert_eq!(parse_css_color("var(--x)"), None);
        assert_eq!(parse_css_color("#12"), None);
    }
}

//! 边缘抽屉收起时的「探头」把手：一个原生圆角卡片窗口（无 WebView）。
//!
//! 为什么不用 WebView：WebView2 有最小宽度，收起态若只留窄条则悬停不可靠；探头虽比旧 8px
//! 细条更宽（休息 68 逻辑像素），仍由原生窗口用 TrackMouseEvent 判定，收起时 quick WebView
//! 整个隐藏、不画也不占 CPU。
//!
//! 交互：
//! - 休息：68×148 逻辑像素，贴边，圆角在朝向屏幕内侧的一侧；顶条为来源色，正文为标题 /「N 项」/ 最多三行对象名。
//! - 鼠标进入：卡片加宽到 168（右缘贴边则向左伸展），不打开抽屉。
//! - TME_HOVER 停留 120ms 或点击：打开抽屉（「划过不弹」）。
//! - 鼠标离开：回到休息宽度。
//!
//! 窗口：WS_POPUP + TOOLWINDOW + TOPMOST + NOACTIVATE。优先用
//! SetWindowCompositionAttribute 的亚克力模糊（不是 Mica）；失败则退回 LAYERED 半透明实底。
//! 颜色：强调色由前端 `pin_handle_color` 告知；正文 / 底色由 `set_chrome`；探头内容由 `set_peek`。

use crate::pin::{PinEdge, Rect};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

/// 停留多久算「碰边停住」（与前端 PIN_HOVER_EXPAND_MS 一致）
pub const HOVER: Duration = Duration::from_millis(120);
const TITLE: &str = "TagLauncher 钉住把手";
/// 亚克力不可用时的整体透明度（约 92%）
const FALLBACK_ALPHA: u8 = 235;
/// 探头悬停宽度相对休息宽度的倍率（168 / 68）
const HOVER_RATIO: f64 = 168.0 / 68.0;
/// 圆角（逻辑像素，按休息宽度折算缩放）
const RADIUS_LOGIC: f64 = 16.0;

#[derive(Clone, Debug, Default)]
pub struct PeekContent {
    pub title: String,
    pub count: usize,
    pub names: Vec<String>,
    /// 顶条来源色（COLORREF），缺省用强调色
    pub stripe: Option<u32>,
}

#[derive(Clone, Debug, Default)]
struct Chrome {
    /// 卡片底（COLORREF）；亚克力的着色也用它
    bg: Option<u32>,
    fg: Option<u32>,
    muted: Option<u32>,
    accent: Option<u32>,
    /// 深色主题时用更暗的亚克力着色
    dark: bool,
}

struct Strip {
    hwnd: isize,
    creating: bool,
    visible: bool,
    /// 休息态矩形（物理像素）
    rect: Rect,
    edge: PinEdge,
    /// 鼠标是否在窗口内（卡片加宽）
    hover: bool,
    color: Option<u32>,
    chrome: Chrome,
    peek: PeekContent,
    acrylic: bool,
}

static STRIP: Mutex<Strip> = Mutex::new(Strip {
    hwnd: 0,
    creating: false,
    visible: false,
    rect: (0, 0, 0, 0),
    edge: PinEdge::Right,
    hover: false,
    color: None,
    chrome: Chrome {
        bg: None,
        fg: None,
        muted: None,
        accent: None,
        dark: false,
    },
    peek: PeekContent {
        title: String::new(),
        count: 0,
        names: Vec::new(),
        stripe: None,
    },
    acrylic: false,
});
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

fn lock() -> std::sync::MutexGuard<'static, Strip> {
    STRIP.lock().unwrap_or_else(|e| e.into_inner())
}

/// 把手当前状态（诊断 / E2E）：是否显示与休息态物理矩形（不含悬停加宽）
pub fn state() -> (bool, Rect) {
    let s = lock();
    (s.hwnd != 0 && s.visible, s.rect)
}

/// 休息矩形按边加宽到悬停宽度（右缘贴边时向左伸展，左缘贴边向右伸展）
pub fn hover_rect(rest: Rect, edge: PinEdge, hover_w: u32) -> Rect {
    let (x, y, w, h) = rest;
    let nw = hover_w.max(w);
    let nx = match edge {
        PinEdge::Right => x - (nw - w) as i32,
        PinEdge::Left => x,
    };
    (nx, y, nw, h)
}

fn hover_width(rest_w: u32) -> u32 {
    ((rest_w as f64) * HOVER_RATIO).round() as u32
}

fn effective_rect(s: &Strip) -> Rect {
    if s.hover {
        hover_rect(s.rect, s.edge, hover_width(s.rect.2))
    } else {
        s.rect
    }
}

/// 在 rect（物理像素，休息态）处显示探头
pub fn show(app: &AppHandle, rect: Rect, edge: PinEdge) {
    {
        let mut s = lock();
        s.visible = true;
        s.rect = rect;
        s.edge = edge;
        s.hover = false;
    }
    apply(app);
}

pub fn hide(app: &AppHandle) {
    {
        let mut s = lock();
        s.visible = false;
        s.hover = false;
    }
    apply(app);
}

/// 前端告知主题强调色（"#rrggbb" / "rgb(r, g, b)"）；解析失败忽略
pub fn set_color(app: &AppHandle, css: &str) {
    let Some(rgb) = parse_css_color(css) else {
        return;
    };
    {
        let mut s = lock();
        if s.color == Some(rgb) && s.chrome.accent == Some(rgb) {
            return;
        }
        s.color = Some(rgb);
        s.chrome.accent = Some(rgb);
    }
    apply(app);
}

/// 前端告知卡片底 / 正文 / 次要文字与是否深色（供探头绘制与亚克力着色）
pub fn set_chrome(app: &AppHandle, bg: &str, fg: &str, muted: &str, dark: bool) {
    let bg = parse_css_color(bg);
    let fg = parse_css_color(fg);
    let muted = parse_css_color(muted);
    {
        let mut s = lock();
        s.chrome.bg = bg;
        s.chrome.fg = fg;
        s.chrome.muted = muted;
        s.chrome.dark = dark;
    }
    apply(app);
}

/// 探头上的标题、数量与预览行（由 pin::show_handle 从 load_items 填入）
pub fn set_peek(app: &AppHandle, peek: PeekContent) {
    {
        let mut s = lock();
        s.peek = peek;
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
    use std::os::raw::c_void;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        BeginPaint, CombineRgn, CreateFontW, CreatePen, CreateRectRgn, CreateRoundRectRgn,
        CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect, GetSysColor, InvalidateRect,
        LineTo, MoveToEx, SelectObject, SetBkMode, SetTextColor, SetWindowRgn, COLOR_HIGHLIGHT,
        PAINTSTRUCT, PS_SOLID,
    };
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_HOVER, TME_LEAVE, TRACKMOUSEEVENT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetClientRect, GetWindowLongW, LoadCursorW, RegisterClassW,
        SetLayeredWindowAttributes, SetWindowLongW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
        HWND_TOPMOST, IDC_HAND, LWA_ALPHA, MA_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE,
        WM_ERASEBKGND, WM_LBUTTONDOWN, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_PAINT, WNDCLASSW,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    /// 部分常量在 windows-sys 的不同 feature 下导出位置不一，这里用 winuser/wingdi 标准值。
    const WM_MOUSEHOVER: u32 = 0x02A1;
    const WM_MOUSELEAVE: u32 = 0x02A3;
    const DT_LEFT: u32 = 0x0000;
    const DT_SINGLELINE: u32 = 0x0020;
    const DT_NOPREFIX: u32 = 0x0800;
    const DT_END_ELLIPSIS: u32 = 0x8000;
    const FW_NORMAL: i32 = 400;
    const FW_SEMIBOLD: i32 = 600;
    const DEFAULT_CHARSET: u32 = 1;
    const CLEARTYPE_QUALITY: u32 = 5;
    const BK_TRANSPARENT: i32 = 1;
    const RGN_OR: i32 = 2;
    const COLOR_WINDOWTEXT: i32 = 8;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: i32 = 4;
    const WCA_ACCENT_POLICY: u32 = 19;

    #[repr(C)]
    struct AccentPolicy {
        accent_state: i32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WinCompAttrData {
        attribute: u32,
        data: *mut c_void,
        data_size: u32,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn scale_of(rest_w: u32) -> f64 {
        // 休息宽度 68 逻辑像素
        (rest_w as f64 / 68.0).max(0.5)
    }

    fn radius_px(rest_w: u32) -> i32 {
        (RADIUS_LOGIC * scale_of(rest_w)).round() as i32
    }

    /// 尝试给窗口套亚克力模糊；成功返回 true。
    unsafe fn try_acrylic(hwnd: HWND, bg: u32, dark: bool) -> bool {
        type SetAttr = unsafe extern "system" fn(HWND, *mut WinCompAttrData) -> i32;
        let user32 = GetModuleHandleW(wide("user32.dll").as_ptr());
        if user32.is_null() {
            return false;
        }
        let Some(f) = GetProcAddress(user32, b"SetWindowCompositionAttribute\0".as_ptr()) else {
            return false;
        };
        let f: SetAttr = std::mem::transmute(f);
        // GradientColor = 0xAABBGGRR（COLORREF + 高位 alpha）
        let alpha: u32 = if dark { 0xCC } else { 0xC0 };
        let gradient = (alpha << 24) | (bg & 0x00FF_FFFF);
        let mut policy = AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 0,
            gradient_color: gradient,
            animation_id: 0,
        };
        let mut data = WinCompAttrData {
            attribute: WCA_ACCENT_POLICY,
            data: (&mut policy) as *mut _ as *mut c_void,
            data_size: std::mem::size_of::<AccentPolicy>() as u32,
        };
        f(hwnd, &mut data) != 0
    }

    fn apply_region(hwnd: HWND, w: i32, h: i32, rest_w: u32, flush_right: bool) {
        let r = radius_px(rest_w).max(4);
        unsafe {
            // +1：CreateRoundRectRgn 的右/下是开区间
            let round = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
            // 贴边一侧改直角，避免与屏幕边缘之间漏出缝
            let square = if flush_right {
                CreateRectRgn(w / 2, 0, w + 1, h + 1)
            } else {
                CreateRectRgn(0, 0, w / 2 + 1, h + 1)
            };
            CombineRgn(round, round, square, RGN_OR);
            SetWindowRgn(hwnd, round, 1);
            DeleteObject(square as _);
            // SetWindowRgn 接管 round，不再 Delete
        }
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
                WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
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
            h as isize
        }
    }

    fn ensure_style_and_acrylic(hwnd: HWND) {
        let (bg, dark) = {
            let s = lock();
            let bg = s.chrome.bg.unwrap_or(if s.chrome.dark {
                0x003A2A21 // 霜靛暗 surface，COLORREF BGR
            } else {
                0x00FAF5F5
            });
            (bg, s.chrome.dark)
        };
        unsafe {
            let ok = try_acrylic(hwnd, bg, dark);
            {
                lock().acrylic = ok;
            }
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            if ok {
                // 亚克力与 LWA_ALPHA 冲突；若之前加过 LAYERED，去掉
                if ex & WS_EX_LAYERED != 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, (ex & !WS_EX_LAYERED) as i32);
                }
            } else {
                if ex & WS_EX_LAYERED == 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_LAYERED) as i32);
                }
                SetLayeredWindowAttributes(hwnd, 0, FALLBACK_ALPHA, LWA_ALPHA);
            }
        }
    }

    /// 按期望状态显示 / 隐藏 / 移动 / 重绘
    pub fn sync(hwnd: isize) {
        let (visible, r, rest_w, flush_right) = {
            let s = lock();
            (s.visible, effective_rect(&s), s.rect.2, s.edge == PinEdge::Right)
        };
        let h = hwnd as HWND;
        // SAFETY：h 是本进程建的把手窗口
        unsafe {
            if visible {
                ensure_style_and_acrylic(h);
                SetWindowPos(
                    h,
                    HWND_TOPMOST,
                    r.0,
                    r.1,
                    r.2 as i32,
                    r.3 as i32,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
                apply_region(h, r.2 as i32, r.3 as i32, rest_w, flush_right);
                InvalidateRect(h, std::ptr::null(), 1);
            } else {
                ShowWindow(h, SW_HIDE);
            }
        }
    }

    fn set_hover(hwnd: HWND, hover: bool) {
        {
            let mut s = lock();
            if s.hover == hover {
                return;
            }
            s.hover = hover;
        }
        sync(hwnd as isize);
    }

    unsafe extern "system" fn proc_(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            WM_ERASEBKGND => 1, // 自己画；避免默认擦除盖住亚克力
            WM_MOUSEMOVE => {
                set_hover(hwnd, true);
                let mut t = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_HOVER | TME_LEAVE,
                    hwndTrack: hwnd,
                    dwHoverTime: HOVER.as_millis() as u32,
                };
                TrackMouseEvent(&mut t);
                0
            }
            WM_MOUSELEAVE => {
                set_hover(hwnd, false);
                0
            }
            WM_MOUSEHOVER | WM_LBUTTONDOWN => {
                if let Some(app) = APP.get() {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = crate::pin::expand(&app, true);
                    });
                }
                0
            }
            WM_PAINT => {
                paint(hwnd);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    fn paint(hwnd: HWND) {
        unsafe {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut ps);
            let (accent, bg, fg, muted, peek, acrylic, rest_w, flush_right) = {
                let s = lock();
                let accent = s
                    .chrome
                    .accent
                    .or(s.color)
                    .unwrap_or_else(|| GetSysColor(COLOR_HIGHLIGHT));
                let bg = s.chrome.bg.unwrap_or(if s.chrome.dark {
                    0x003A2A21
                } else {
                    0x00FFFFF8
                });
                let fg = s
                    .chrome
                    .fg
                    .unwrap_or_else(|| GetSysColor(COLOR_WINDOWTEXT));
                let muted = s.chrome.muted.unwrap_or({
                    let r = fg & 0xff;
                    let g = (fg >> 8) & 0xff;
                    let b = (fg >> 16) & 0xff;
                    ((r * 5 / 8) | ((g * 5 / 8) << 8) | ((b * 5 / 8) << 16)) as u32
                });
                (
                    accent,
                    bg,
                    fg,
                    muted,
                    s.peek.clone(),
                    s.acrylic,
                    s.rect.2,
                    s.edge == PinEdge::Right,
                )
            };
            let mut rc: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut rc);
            let w = (rc.right - rc.left).max(1);
            let h = (rc.bottom - rc.top).max(1);
            let scale = scale_of(rest_w);

            // 亚克力开启时不铺实底，让 DWM 模糊透出；退回分层窗口时铺半透明实底
            if !acrylic {
                let brush = CreateSolidBrush(bg);
                FillRect(dc, &rc, brush);
                DeleteObject(brush as _);
            }

            // 顶条：来源色（6 逻辑像素）
            let stripe_h = ((6.0 * scale).round() as i32).max(3);
            let stripe = peek.stripe.unwrap_or(accent);
            let stripe_brush = CreateSolidBrush(stripe);
            let stripe_rc = RECT {
                left: rc.left,
                top: rc.top,
                right: rc.right,
                bottom: rc.top + stripe_h,
            };
            FillRect(dc, &stripe_rc, stripe_brush);
            DeleteObject(stripe_brush as _);

            // 细边高光：内侧 1px 淡白，贴边一侧不画以免漏缝
            let hi: u32 = 0x00FFFFFF;
            let pen = CreatePen(PS_SOLID, 1, hi);
            let old_pen = SelectObject(dc, pen as _);
            let inset = 1;
            let x1 = rc.left + inset;
            let y1 = rc.top + inset + stripe_h.min(0); // 顶条之下仍沿顶画，被顶条盖住也无妨
            let x2 = rc.right - inset;
            let y2 = rc.bottom - inset;
            let _ = y1;
            if flush_right {
                MoveToEx(dc, x1, y2, std::ptr::null_mut());
                LineTo(dc, x1, rc.top + inset);
                LineTo(dc, x2, rc.top + inset);
            } else {
                MoveToEx(dc, x2, y2, std::ptr::null_mut());
                LineTo(dc, x2, rc.top + inset);
                LineTo(dc, x1, rc.top + inset);
            }
            SelectObject(dc, old_pen);
            DeleteObject(pen as _);

            SetBkMode(dc, BK_TRANSPARENT);

            let pad = ((10.0 * scale).round() as i32).max(6);
            let mut y = rc.top + stripe_h + ((8.0 * scale).round() as i32).max(4);
            let text_right = rc.right - pad + 2;
            let text_left = rc.left + pad;

            // 标题
            let title = if peek.title.is_empty() {
                "钉住视图".to_string()
            } else {
                peek.title.clone()
            };
            let font_title = CreateFontW(
                -((15.0 * scale).round() as i32).max(12),
                0,
                0,
                0,
                FW_SEMIBOLD,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                0,
                0,
                CLEARTYPE_QUALITY,
                0,
                wide("Microsoft YaHei UI").as_ptr(),
            );
            let old_font = SelectObject(dc, font_title as _);
            SetTextColor(dc, fg);
            let mut title_w = wide(&title);
            let mut tr = RECT {
                left: text_left,
                top: y,
                right: text_right,
                bottom: y + ((22.0 * scale).round() as i32).max(16),
            };
            DrawTextW(
                dc,
                title_w.as_mut_ptr(),
                (title_w.len() - 1) as i32,
                &mut tr,
                DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
            );
            y = tr.bottom + ((2.0 * scale).round() as i32);
            SelectObject(dc, old_font);
            DeleteObject(font_title as _);

            // 「N 项」
            let sub = format!("{} 项", peek.count);
            let font_sub = CreateFontW(
                -((12.0 * scale).round() as i32).max(10),
                0,
                0,
                0,
                FW_NORMAL,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                0,
                0,
                CLEARTYPE_QUALITY,
                0,
                wide("Microsoft YaHei UI").as_ptr(),
            );
            let old_font = SelectObject(dc, font_sub as _);
            SetTextColor(dc, muted);
            let mut sub_w = wide(&sub);
            let mut sr = RECT {
                left: text_left,
                top: y,
                right: text_right,
                bottom: y + ((18.0 * scale).round() as i32).max(14),
            };
            DrawTextW(
                dc,
                sub_w.as_mut_ptr(),
                (sub_w.len() - 1) as i32,
                &mut sr,
                DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
            );
            y = sr.bottom + ((6.0 * scale).round() as i32);

            // 最多三行对象名
            for name in peek.names.iter().take(3) {
                let mut nw = wide(name);
                let mut nr = RECT {
                    left: text_left,
                    top: y,
                    right: text_right,
                    bottom: y + ((18.0 * scale).round() as i32).max(14),
                };
                DrawTextW(
                    dc,
                    nw.as_mut_ptr(),
                    (nw.len() - 1) as i32,
                    &mut nr,
                    DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
                );
                y = nr.bottom + ((2.0 * scale).round() as i32);
                if y > rc.bottom - 4 {
                    break;
                }
            }
            SelectObject(dc, old_font);
            DeleteObject(font_sub as _);

            let _ = (w, h); // 保持可读
            EndPaint(hwnd, &ps);
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

    #[test]
    fn hover_grows_inward_keeping_flush_edge() {
        // 右缘：x 左移、右边不动
        let rest = (1852, 200, 68, 148);
        let h = hover_rect(rest, PinEdge::Right, 168);
        assert_eq!(h, (1752, 200, 168, 148));
        assert_eq!(h.0 + h.2 as i32, rest.0 + rest.2 as i32);
        // 左缘：x 不动、向右加宽
        let rest = (0, 80, 68, 148);
        let h = hover_rect(rest, PinEdge::Left, 168);
        assert_eq!(h, (0, 80, 168, 148));
    }
}

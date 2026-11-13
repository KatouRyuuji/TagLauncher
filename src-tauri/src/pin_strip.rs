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
//! 窗口：WS_POPUP + TOOLWINDOW + TOPMOST + NOACTIVATE + LAYERED。
//! 用 `UpdateLayeredWindow` 上传预乘 BGRA：软件抗锯齿圆角（仅内侧）、边距里较淡的软阴影、
//! 1px 描边（贴边一侧不画，避免屏幕边缘发丝）、灰度抗锯齿文字（不用 ClearType）。
//! 文字在拷入预乘缓冲前按覆盖率做对比度提升并以线性空间再合成，避免 12px 灰度 AA 发细发灰。
//! 卡片本体约 98% 不透明，桌面图标不会透过来；通透感靠顶部高光，不靠把整张卡片画淡。
//! 不用 `SetWindowRgn`（会锯齿）也不用 `SetLayeredWindowAttributes`（与按像素 alpha 冲突）。
//! HWND 比卡片大一圈阴影边距（约 10 逻辑像素）；贴边一侧边距为 0，仍与工作区齐平。阴影区点击穿透。
//! 颜色：强调色由前端 `pin_handle_color` 告知；正文 / 底色由 `set_chrome`；探头内容由 `set_peek`。

use crate::pin::{PinEdge, Rect};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

/// 停留多久算「碰边停住」（与前端 PIN_HOVER_EXPAND_MS 一致）
pub const HOVER: Duration = Duration::from_millis(120);
const TITLE: &str = "TagLauncher 钉住把手";
/// 探头悬停宽度相对休息宽度的倍率（168 / 68）
const HOVER_RATIO: f64 = 168.0 / 68.0;
/// 圆角（逻辑像素，按休息宽度折算缩放）
const RADIUS_LOGIC: f64 = 16.0;
/// 阴影边距（逻辑像素）。贴边一侧为 0。比卡片宽度 68 小一截，避免一圈发闷的黑晕。
pub const SHADOW_LOGIC: f64 = 10.0;
/// 阴影峰值不透明度（紧贴卡片外侧）。0.18–0.22：淡、不浑。
pub const SHADOW_PEAK: f64 = 0.20;
/// 灰度 AA 覆盖率对比度：`cov' = 1 - (1-cov)^power`。>1 让字重更实，不引入 ClearType 彩边。
pub const TEXT_AA_POWER: f64 = 1.85;
/// 卡片本体不透明度（约 98%）：图标不得从底下透出来。
pub const BODY_ALPHA: u8 = 250;

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
    /// 卡片底（COLORREF）
    bg: Option<u32>,
    fg: Option<u32>,
    muted: Option<u32>,
    accent: Option<u32>,
    /// 深色主题
    dark: bool,
}

struct Strip {
    hwnd: isize,
    creating: bool,
    visible: bool,
    /// 休息态矩形（物理像素，仅卡片，不含阴影边距）
    rect: Rect,
    edge: PinEdge,
    /// 鼠标是否在窗口内（卡片加宽）
    hover: bool,
    color: Option<u32>,
    chrome: Chrome,
    peek: PeekContent,
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
});
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

fn lock() -> std::sync::MutexGuard<'static, Strip> {
    STRIP.lock().unwrap_or_else(|e| e.into_inner())
}

/// 把手当前状态（诊断 / E2E）：是否显示与休息态物理矩形（仅卡片，不含阴影边距）
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

fn scale_of(rest_w: u32) -> f64 {
    (rest_w as f64 / 68.0).max(0.5)
}

/// 阴影边距（物理像素）
pub fn shadow_margin(rest_w: u32) -> i32 {
    (SHADOW_LOGIC * scale_of(rest_w)).round() as i32
}

/// 含阴影的 HWND 外框。贴边一侧边距为 0，保持与工作区齐平。
pub fn frame_rect(card: Rect, flush_right: bool, rest_w: u32) -> Rect {
    let m = shadow_margin(rest_w);
    let (x, y, w, h) = card;
    if flush_right {
        (x - m, y - m, w + m as u32, h + (2 * m) as u32)
    } else {
        (x, y - m, w + m as u32, h + (2 * m) as u32)
    }
}

/// 卡片在 HWND 客户区中的原点（贴边一侧 x=0 或阴影在左时 x=m；y 始终为 m）
pub fn card_origin_in_frame(flush_right: bool, rest_w: u32) -> (i32, i32) {
    let m = shadow_margin(rest_w);
    if flush_right {
        (m, m)
    } else {
        (0, m)
    }
}

/// 圆角矩形的有向距离（负值在内部）。四角半径独立，贴边一侧传 0。
pub fn sd_round_rect(
    px: f64,
    py: f64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    rtl: f64,
    rtr: f64,
    rbl: f64,
    rbr: f64,
) -> f64 {
    let r = if py < y + h * 0.5 {
        if px < x + w * 0.5 {
            rtl
        } else {
            rtr
        }
    } else if px < x + w * 0.5 {
        rbl
    } else {
        rbr
    };
    let r = r.max(0.0).min(w.min(h) * 0.5);
    let cx = x + w * 0.5;
    let cy = y + h * 0.5;
    let hx = (w * 0.5 - r).max(0.0);
    let hy = (h * 0.5 - r).max(0.0);
    let dx = (px - cx).abs() - hx;
    let dy = (py - cy).abs() - hy;
    let ax = dx.max(0.0);
    let ay = dy.max(0.0);
    ax.hypot(ay) + dx.min(0.0).max(dy.min(0.0)) - r
}

pub fn coverage(sd: f64) -> f64 {
    (0.5 - sd).clamp(0.0, 1.0)
}

fn corner_radii(flush_right: bool, rest_w: u32) -> (f64, f64, f64, f64) {
    let r = RADIUS_LOGIC * scale_of(rest_w);
    if flush_right {
        (r, 0.0, r, 0.0)
    } else {
        (0.0, r, 0.0, r)
    }
}

/// 点是否落在卡片上（含抗锯齿边缘的实心侧）。阴影区返回 false，供点击穿透。
pub fn hit_in_card(px: i32, py: i32, card: Rect, flush_right: bool, rest_w: u32) -> bool {
    let (x, y, w, h) = card;
    let (rtl, rtr, rbl, rbr) = corner_radii(flush_right, rest_w);
    coverage(sd_round_rect(
        px as f64 + 0.5,
        py as f64 + 0.5,
        x as f64,
        y as f64,
        w as f64,
        h as f64,
        rtl,
        rtr,
        rbl,
        rbr,
    )) >= 0.5
}

fn colorref_channels(c: u32) -> (u8, u8, u8) {
    (
        (c & 0xff) as u8,
        ((c >> 8) & 0xff) as u8,
        ((c >> 16) & 0xff) as u8,
    )
}

fn blend_over(dst: &mut [u8], i: usize, r: u8, g: u8, b: u8, a: f64) {
    let sa = a.clamp(0.0, 1.0);
    if sa <= 0.0 {
        return;
    }
    let ia = 1.0 - sa;
    dst[i] = (b as f64 * sa + dst[i] as f64 * ia).round() as u8;
    dst[i + 1] = (g as f64 * sa + dst[i + 1] as f64 * ia).round() as u8;
    dst[i + 2] = (r as f64 * sa + dst[i + 2] as f64 * ia).round() as u8;
    dst[i + 3] = ((sa * 255.0) + dst[i + 3] as f64 * ia)
        .round()
        .clamp(0.0, 255.0) as u8;
}

/// 把卡片、描边、顶条、高光和软阴影栅格化到预乘 BGRA（自上而下，stride = width×4）。
pub fn rasterize_handle(
    pixels: &mut [u8],
    frame_w: u32,
    frame_h: u32,
    card_w: u32,
    card_h: u32,
    flush_right: bool,
    rest_w: u32,
    bg: u32,
    muted: u32,
    stripe: u32,
    body_alpha: u8,
) {
    let fw = frame_w as usize;
    let fh = frame_h as usize;
    if pixels.len() < fw * fh * 4 {
        return;
    }
    pixels[..fw * fh * 4].fill(0);
    let (ox, oy) = card_origin_in_frame(flush_right, rest_w);
    let scale = scale_of(rest_w);
    let (rtl, rtr, rbl, rbr) = corner_radii(flush_right, rest_w);
    let m = shadow_margin(rest_w) as f64;
    let off_y = (2.0 * scale).round();
    let off_x = if flush_right {
        -scale.round()
    } else {
        scale.round()
    };
    let stripe_h = ((3.0 * scale).round() as f64).max(2.0);
    let (br, bgc, bb) = colorref_channels(bg);
    let (mr, mg, mb) = colorref_channels(muted);
    let (sr, sg, sb) = colorref_channels(stripe);
    let body_a = body_alpha as f64 / 255.0;

    for y in 0..fh {
        for x in 0..fw {
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            let sd = sd_round_rect(
                px,
                py,
                ox as f64,
                oy as f64,
                card_w as f64,
                card_h as f64,
                rtl,
                rtr,
                rbl,
                rbr,
            );
            let sd_shadow = sd_round_rect(
                px - off_x,
                py - off_y,
                ox as f64,
                oy as f64,
                card_w as f64,
                card_h as f64,
                rtl,
                rtr,
                rbl,
                rbr,
            );
            let i = (y * fw + x) * 4;
            // 软阴影：只画在卡片外面；峰值约 0.20，二次衰减，比 16px/0.40 的旧晕更淡更窄。
            if sd > 0.0 && sd_shadow < m && m > 0.0 {
                let t = (1.0 - (sd_shadow.max(0.0) / m)).clamp(0.0, 1.0);
                let sa = t * t * SHADOW_PEAK;
                blend_over(&mut pixels[i..i + 4], 0, 0, 0, 0, sa);
            }
            let cov = coverage(sd);
            if cov > 0.0 {
                blend_over(&mut pixels[i..i + 4], 0, br, bgc, bb, body_a * cov);
                // 顶条
                let ly = py - oy as f64;
                if ly < stripe_h {
                    let sc = ((stripe_h - ly).clamp(0.0, 1.0)).min(cov);
                    blend_over(&mut pixels[i..i + 4], 0, sr, sg, sb, sc);
                }
                // 顶部 1px 内高光（通透感来自这里，不是低 alpha）
                if ly >= stripe_h && ly < stripe_h + 1.2 {
                    let hc = (1.2 - (ly - stripe_h)).clamp(0.0, 1.0) * cov * 0.42;
                    blend_over(&mut pixels[i..i + 4], 0, 255, 255, 255, hc);
                }
            }
            // 1px 描边：贴边一侧不画，避免屏幕边缘出现发丝缝。
            let ring = coverage(sd.abs() - 0.5);
            if ring > 0.0 {
                let flush_fade = if flush_right {
                    ((ox as f64 + card_w as f64 - 1.0) - px).clamp(0.0, 1.0)
                } else {
                    (px - ox as f64).clamp(0.0, 1.0)
                };
                let ra = ring * flush_fade * 0.92;
                if ra > 0.001 {
                    blend_over(&mut pixels[i..i + 4], 0, mr, mg, mb, ra);
                }
            }
        }
    }
}

/// 在 rect（物理像素，休息态卡片）处显示探头
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

/// 前端告知卡片底 / 正文 / 次要文字与是否深色（供探头绘制）
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

/// COLORREF（0x00BBGGRR）相对亮度 0–255（BT.601）
pub fn colorref_luma(c: u32) -> u32 {
    let r = c & 0xff;
    let g = (c >> 8) & 0xff;
    let b = (c >> 16) & 0xff;
    (r * 299 + g * 587 + b * 114) / 1000
}

/// sRGB 8-bit 通道 → 线性光（WCAG 2）
pub fn srgb_to_linear(c: f64) -> f64 {
    let c = (c / 255.0).clamp(0.0, 1.0);
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// COLORREF 的 WCAG 相对亮度
pub fn wcag_luminance(c: u32) -> f64 {
    let (r, g, b) = colorref_channels(c);
    0.2126 * srgb_to_linear(r as f64)
        + 0.7152 * srgb_to_linear(g as f64)
        + 0.0722 * srgb_to_linear(b as f64)
}

/// WCAG 2 对比度（≥1）
pub fn wcag_contrast(a: u32, b: u32) -> f64 {
    let la = wcag_luminance(a);
    let lb = wcag_luminance(b);
    let (hi, lo) = if la >= lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

fn pack_colorref(r: u8, g: u8, b: u8) -> u32 {
    r as u32 | ((g as u32) << 8) | ((b as u32) << 16)
}

/// 把 `c` 朝黑（浅底）或白（深底）推，直到与 `bg` 的对比度达到 `min_ratio`。
pub fn ensure_contrast(c: u32, bg: u32, min_ratio: f64) -> u32 {
    if wcag_contrast(c, bg) >= min_ratio {
        return c;
    }
    let toward = if wcag_luminance(bg) >= 0.5 {
        0x00000000
    } else {
        0x00FFFFFF
    };
    let (cr, cg, cb) = colorref_channels(c);
    let (tr, tg, tb) = colorref_channels(toward);
    let mut lo = 0.0;
    let mut hi = 1.0;
    let mut best = toward;
    for _ in 0..16 {
        let t = (lo + hi) * 0.5;
        let r = (cr as f64 + (tr as f64 - cr as f64) * t).round() as u8;
        let g = (cg as f64 + (tg as f64 - cg as f64) * t).round() as u8;
        let b = (cb as f64 + (tb as f64 - cb as f64) * t).round() as u8;
        let mixed = pack_colorref(r, g, b);
        if wcag_contrast(mixed, bg) >= min_ratio {
            best = mixed;
            hi = t;
        } else {
            lo = t;
        }
    }
    if wcag_contrast(best, bg) >= min_ratio {
        best
    } else {
        toward
    }
}

/// 标题色：相对底色至少 7:1（WCAG AAA 小字）。不够则朝黑/白推到刚好达标。
pub fn contrast_fg(fg: u32, bg: u32) -> u32 {
    ensure_contrast(fg, bg, 7.0)
}

/// 次要文字（「N 项」、文件名行）：至少 4.5:1，并再收一级更深，避免 12px 发灰。
pub fn contrast_muted(fg: u32, bg: u32) -> u32 {
    let base = ensure_contrast(fg, bg, 4.5);
    let (r, g, b) = colorref_channels(base);
    let light = wcag_luminance(bg) >= 0.5;
    let (r, g, b) = if light {
        // 比主题 muted（如 #626e7c）更深：约 0.55，仍比标题略浅。
        (
            (r as f64 * 0.55).round() as u8,
            (g as f64 * 0.55).round() as u8,
            (b as f64 * 0.55).round() as u8,
        )
    } else {
        (
            (r as f64 + (255.0 - r as f64) * 0.35).round() as u8,
            (g as f64 + (255.0 - g as f64) * 0.35).round() as u8,
            (b as f64 + (255.0 - b as f64) * 0.35).round() as u8,
        )
    };
    ensure_contrast(pack_colorref(r, g, b), bg, 4.5)
}

fn color_dist2(a: (u8, u8, u8), b: (u8, u8, u8)) -> i32 {
    let dr = a.0 as i32 - b.0 as i32;
    let dg = a.1 as i32 - b.1 as i32;
    let db = a.2 as i32 - b.2 as i32;
    dr * dr + dg * dg + db * db
}

fn dist_to_segment(p: (u8, u8, u8), a: (u8, u8, u8), b: (u8, u8, u8)) -> f64 {
    let ab = (
        b.0 as f64 - a.0 as f64,
        b.1 as f64 - a.1 as f64,
        b.2 as f64 - a.2 as f64,
    );
    let ap = (
        p.0 as f64 - a.0 as f64,
        p.1 as f64 - a.1 as f64,
        p.2 as f64 - a.2 as f64,
    );
    let ab2 = ab.0 * ab.0 + ab.1 * ab.1 + ab.2 * ab.2;
    if ab2 < 1.0 {
        return (color_dist2(p, a) as f64).sqrt();
    }
    let t = ((ap.0 * ab.0 + ap.1 * ab.1 + ap.2 * ab.2) / ab2).clamp(0.0, 1.0);
    let qx = a.0 as f64 + ab.0 * t - p.0 as f64;
    let qy = a.1 as f64 + ab.1 * t - p.1 as f64;
    let qz = a.2 as f64 + ab.2 * t - p.2 as f64;
    (qx * qx + qy * qy + qz * qz).sqrt()
}

/// 从 GDI sRGB 混合结果还原覆盖率，做对比度提升后再合成到 `fg`/`muted`。
pub fn enhance_aa_pixel(
    out: (u8, u8, u8),
    fg: (u8, u8, u8),
    muted: (u8, u8, u8),
    bg: (u8, u8, u8),
    power: f64,
) -> (u8, u8, u8) {
    let ink = if dist_to_segment(out, bg, fg) <= dist_to_segment(out, bg, muted) {
        fg
    } else {
        muted
    };
    let mut cov_sum = 0.0;
    let mut cov_n = 0.0;
    let oc = [out.0, out.1, out.2];
    let ic = [ink.0, ink.1, ink.2];
    let bc = [bg.0, bg.1, bg.2];
    for i in 0..3 {
        let denom = ic[i] as f64 - bc[i] as f64;
        if denom.abs() > 1.0 {
            cov_sum += ((oc[i] as f64 - bc[i] as f64) / denom).clamp(0.0, 1.0);
            cov_n += 1.0;
        }
    }
    if cov_n < 1.0 {
        return out;
    }
    // 覆盖率提升后仍在 sRGB 里合成：GDI 本来就在 sRGB 混合，再走线性会把提升抵消掉，字依旧发灰。
    let cov = 1.0 - (1.0 - cov_sum / cov_n).powf(power.max(1.0));
    let comp = |f: u8, b: u8| {
        (cov * f as f64 + (1.0 - cov) * b as f64)
            .round()
            .clamp(0.0, 255.0) as u8
    };
    (comp(ink.0, bg.0), comp(ink.1, bg.1), comp(ink.2, bg.2))
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
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        BeginPaint, CreateCompatibleDC, CreateDIBSection, CreateFontW, CreateSolidBrush, DeleteDC,
        DeleteObject, DrawTextW, EndPaint, FillRect, GetSysColor, SelectObject, SetBkMode,
        SetTextColor, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, COLOR_HIGHLIGHT, DIB_RGB_COLORS,
        PAINTSTRUCT,
    };
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_HOVER, TME_LEAVE, TRACKMOUSEEVENT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetClientRect, GetWindowLongW, GetWindowRect, LoadCursorW,
        RegisterClassW, SetWindowLongW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
        IDC_HAND, MA_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WM_ERASEBKGND,
        WM_LBUTTONDOWN, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_PAINT, WNDCLASSW, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    const WM_NCHITTEST: u32 = 0x0084;
    const WM_MOUSEHOVER: u32 = 0x02A1;
    const WM_MOUSELEAVE: u32 = 0x02A3;
    const DT_LEFT: u32 = 0x0000;
    const DT_SINGLELINE: u32 = 0x0020;
    const DT_NOPREFIX: u32 = 0x0800;
    const DT_END_ELLIPSIS: u32 = 0x8000;
    const FW_NORMAL: i32 = 400;
    const FW_SEMIBOLD: i32 = 600;
    const BK_TRANSPARENT: i32 = 1;
    const COLOR_WINDOWTEXT: i32 = 8;
    const CS_HREDRAW: u32 = 0x0002;
    const CS_VREDRAW: u32 = 0x0001;
    /// 灰度抗锯齿：分层预乘 alpha 上 ClearType 会带彩边。
    const ANTIALIASED_QUALITY: u32 = 4;
    const GB2312_CHARSET: u32 = 134;
    const HTCLIENT: isize = 1;
    const HTTRANSPARENT: isize = -1;
    const ULW_ALPHA: u32 = 0x0000_0002;
    const AC_SRC_OVER: u8 = 0;
    const AC_SRC_ALPHA: u8 = 1;

    #[repr(C)]
    struct BlendFunction {
        blend_op: u8,
        blend_flags: u8,
        source_constant_alpha: u8,
        alpha_format: u8,
    }

    #[repr(C)]
    struct Size {
        cx: i32,
        cy: i32,
    }

    type UpdateLayeredFn = unsafe extern "system" fn(
        HWND,
        *mut c_void,
        *const POINT,
        *const Size,
        *mut c_void,
        *const POINT,
        u32,
        *const BlendFunction,
        u32,
    ) -> i32;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn proc_addr(h: windows_sys::Win32::Foundation::HMODULE, name: &[u8]) -> *const c_void {
        // windows-sys 0.59 的 FARPROC 是 Option<fn()>；转成指针再判空。
        let proc = unsafe { GetProcAddress(h, name.as_ptr() as _) };
        unsafe { std::mem::transmute(proc) }
    }

    /// 主线程：注册类并建窗口（初始隐藏）。失败返回 0。
    pub fn create() -> isize {
        let class = wide("TagLauncherPinStrip");
        let title = wide(TITLE);
        // SAFETY：标准 Win32 窗口创建；字符串缓冲在调用期间有效
        unsafe {
            let hinst = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
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
            RegisterClassW(&wc);
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
            h as isize
        }
    }

    fn ensure_layered_style(hwnd: HWND) {
        unsafe {
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            if ex & WS_EX_LAYERED == 0 {
                SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_LAYERED) as i32);
            }
        }
    }

    /// 按期望状态显示 / 隐藏 / 移动 / 重绘
    pub fn sync(hwnd: isize) {
        let (visible, card, rest_w, flush_right) = {
            let s = lock();
            (
                s.visible,
                effective_rect(&s),
                s.rect.2,
                s.edge == PinEdge::Right,
            )
        };
        let h = hwnd as HWND;
        // SAFETY：h 是本进程建的把手窗口
        unsafe {
            if visible {
                ensure_layered_style(h);
                let frame = frame_rect(card, flush_right, rest_w);
                SetWindowPos(
                    h,
                    HWND_TOPMOST,
                    frame.0,
                    frame.1,
                    frame.2 as i32,
                    frame.3 as i32,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
                present(h);
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

    fn client_card(hwnd: HWND) -> Option<(Rect, bool, u32)> {
        let (card_w, card_h, rest_w, flush_right) = {
            let s = lock();
            let r = effective_rect(&s);
            (r.2, r.3, s.rect.2, s.edge == PinEdge::Right)
        };
        let (ox, oy) = card_origin_in_frame(flush_right, rest_w);
        let _ = hwnd;
        Some(((ox, oy, card_w, card_h), flush_right, rest_w))
    }

    unsafe extern "system" fn proc_(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            WM_ERASEBKGND => 1,
            WM_NCHITTEST => {
                let sx = (lparam & 0xffff) as i16 as i32;
                let sy = ((lparam >> 16) & 0xffff) as i16 as i32;
                let mut wr: RECT = std::mem::zeroed();
                GetWindowRect(hwnd, &mut wr);
                let px = sx - wr.left;
                let py = sy - wr.top;
                if let Some((card, flush_right, rest_w)) = client_card(hwnd) {
                    if hit_in_card(px, py, card, flush_right, rest_w) {
                        return HTCLIENT as LRESULT;
                    }
                }
                HTTRANSPARENT as LRESULT
            }
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
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                BeginPaint(hwnd, &mut ps);
                EndPaint(hwnd, &ps);
                present(hwnd);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    fn create_ui_font(height: i32, weight: i32) -> *mut c_void {
        for name in [
            "Microsoft YaHei UI",
            "Microsoft YaHei",
            "Noto Sans SC",
            "Segoe UI",
        ] {
            let font = unsafe {
                CreateFontW(
                    height,
                    0,
                    0,
                    0,
                    weight,
                    0,
                    0,
                    0,
                    GB2312_CHARSET,
                    0,
                    0,
                    ANTIALIASED_QUALITY,
                    0,
                    wide(name).as_ptr(),
                )
            };
            if !font.is_null() {
                return font;
            }
        }
        std::ptr::null_mut()
    }

    fn update_layered(hwnd: HWND, src: *mut c_void, w: i32, h: i32) -> bool {
        // SAFETY：user32 常驻；UpdateLayeredWindow 签名与文档一致。
        unsafe {
            let user32 = GetModuleHandleW(wide("user32.dll").as_ptr());
            if user32.is_null() {
                return false;
            }
            let proc = proc_addr(user32, b"UpdateLayeredWindow\0");
            if proc.is_null() {
                return false;
            }
            let f: UpdateLayeredFn = std::mem::transmute(proc);
            let size = Size { cx: w, cy: h };
            let src_pt = POINT { x: 0, y: 0 };
            let blend = BlendFunction {
                blend_op: AC_SRC_OVER,
                blend_flags: 0,
                source_constant_alpha: 255,
                alpha_format: AC_SRC_ALPHA,
            };
            f(
                hwnd,
                std::ptr::null_mut(),
                std::ptr::null(),
                &size,
                src,
                &src_pt,
                0,
                &blend,
                ULW_ALPHA,
            ) != 0
        }
    }

    fn present(hwnd: HWND) {
        unsafe {
            let (accent, bg, mut fg, mut muted, peek, rest_w, flush_right, card) = {
                let s = lock();
                let accent = s
                    .chrome
                    .accent
                    .or(s.color)
                    .unwrap_or_else(|| GetSysColor(COLOR_HIGHLIGHT));
                let bg = s.chrome.bg.unwrap_or(if s.chrome.dark {
                    0x00201C1C // #1c1c20，明亮深色，不是闷灰
                } else {
                    0x00FCFAFA // #fafafc
                });
                let fg = s.chrome.fg.unwrap_or_else(|| GetSysColor(COLOR_WINDOWTEXT));
                let muted = s.chrome.muted.unwrap_or(fg);
                (
                    accent,
                    bg,
                    fg,
                    muted,
                    s.peek.clone(),
                    s.rect.2,
                    s.edge == PinEdge::Right,
                    effective_rect(&s),
                )
            };
            let mut rc: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut rc);
            let fw = (rc.right - rc.left).max(1);
            let fh = (rc.bottom - rc.top).max(1);
            let scale = scale_of(rest_w);
            fg = contrast_fg(fg, bg);
            muted = contrast_muted(muted, bg);
            let stripe = peek.stripe.unwrap_or(accent);
            let (ox, oy) = card_origin_in_frame(flush_right, rest_w);
            let cw = card.2;
            let ch = card.3;

            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: fw,
                biHeight: -fh, // 自上而下
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            };
            let mem = CreateCompatibleDC(std::ptr::null_mut());
            if mem.is_null() {
                return;
            }
            let mut bits: *mut c_void = std::ptr::null_mut();
            let dib = CreateDIBSection(
                mem,
                &bmi,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            if dib.is_null() || bits.is_null() {
                DeleteDC(mem);
                return;
            }
            let old_bmp = SelectObject(mem, dib as _);
            let len = (fw as usize) * (fh as usize) * 4;
            let buf = std::slice::from_raw_parts_mut(bits as *mut u8, len);
            rasterize_handle(
                buf,
                fw as u32,
                fh as u32,
                cw,
                ch,
                flush_right,
                rest_w,
                bg,
                muted,
                stripe,
                BODY_ALPHA,
            );

            // 文字画在不透明卡片上：另开一张与卡片同大的 DIB，GDI 灰度抗锯齿后再拷回。
            let mut t_bmi: BITMAPINFO = std::mem::zeroed();
            t_bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: cw as i32,
                biHeight: -(ch as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            };
            let tdc = CreateCompatibleDC(mem);
            let mut t_bits: *mut c_void = std::ptr::null_mut();
            let t_dib = CreateDIBSection(
                tdc,
                &t_bmi,
                DIB_RGB_COLORS,
                &mut t_bits,
                std::ptr::null_mut(),
                0,
            );
            if !tdc.is_null() && !t_dib.is_null() && !t_bits.is_null() {
                let old_t = SelectObject(tdc, t_dib as _);
                let (br, bgc, bb) = colorref_channels(bg);
                // GDI 在 32 位 DIB 上用 COLORREF 铺底；之后按字节读 BGRA。
                let brush = CreateSolidBrush(bg);
                let fill = RECT {
                    left: 0,
                    top: 0,
                    right: cw as i32,
                    bottom: ch as i32,
                };
                FillRect(tdc, &fill, brush);
                DeleteObject(brush as _);
                SetBkMode(tdc, BK_TRANSPARENT);

                let pad = ((10.0 * scale).round() as i32).max(6);
                let stripe_h = ((3.0 * scale).round() as i32).max(2);
                let mut y = stripe_h + ((8.0 * scale).round() as i32).max(4);
                let text_right = cw as i32 - pad + 2;
                let text_left = pad;

                let title = if peek.title.is_empty() {
                    "钉住视图".to_string()
                } else {
                    peek.title.clone()
                };
                let font_title =
                    create_ui_font(-((15.0 * scale).round() as i32).max(12), FW_SEMIBOLD);
                let old_font = SelectObject(tdc, font_title as _);
                SetTextColor(tdc, fg);
                let mut title_w = wide(&title);
                let mut tr = RECT {
                    left: text_left,
                    top: y,
                    right: text_right,
                    bottom: y + ((22.0 * scale).round() as i32).max(16),
                };
                DrawTextW(
                    tdc,
                    title_w.as_mut_ptr(),
                    (title_w.len() - 1) as i32,
                    &mut tr,
                    DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
                );
                y = tr.bottom + ((2.0 * scale).round() as i32);
                SelectObject(tdc, old_font);
                DeleteObject(font_title as _);

                let sub = format!("{} 项", peek.count);
                let font_sub = create_ui_font(-((12.0 * scale).round() as i32).max(10), FW_NORMAL);
                let old_font = SelectObject(tdc, font_sub as _);
                SetTextColor(tdc, muted);
                let mut sub_w = wide(&sub);
                let mut sr = RECT {
                    left: text_left,
                    top: y,
                    right: text_right,
                    bottom: y + ((18.0 * scale).round() as i32).max(14),
                };
                DrawTextW(
                    tdc,
                    sub_w.as_mut_ptr(),
                    (sub_w.len() - 1) as i32,
                    &mut sr,
                    DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
                );
                y = sr.bottom + ((6.0 * scale).round() as i32);

                // 文件名行用次要色（已保证 ≥ 4.5:1），与「N 项」同一支。
                for name in peek.names.iter().take(3) {
                    let mut nw = wide(name);
                    let mut nr = RECT {
                        left: text_left,
                        top: y,
                        right: text_right,
                        bottom: y + ((18.0 * scale).round() as i32).max(14),
                    };
                    DrawTextW(
                        tdc,
                        nw.as_mut_ptr(),
                        (nw.len() - 1) as i32,
                        &mut nr,
                        DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX,
                    );
                    y = nr.bottom + ((2.0 * scale).round() as i32);
                    if y > ch as i32 - 4 {
                        break;
                    }
                }
                SelectObject(tdc, old_font);
                DeleteObject(font_sub as _);

                // 把与底色不同的像素拷到主缓冲。GDI 灰度 AA 先提升覆盖率、线性再合成，再预乘。
                let t_len = (cw as usize) * (ch as usize) * 4;
                let tbuf = std::slice::from_raw_parts(t_bits as *const u8, t_len);
                let dst_w = fw as usize;
                let body_a = BODY_ALPHA;
                let (fr, fgc, fb) = colorref_channels(fg);
                let (mr2, mg2, mb2) = colorref_channels(muted);
                for ty in 0..(ch as usize) {
                    for tx in 0..(cw as usize) {
                        let ti = (ty * cw as usize + tx) * 4;
                        let b = tbuf[ti];
                        let g = tbuf[ti + 1];
                        let r = tbuf[ti + 2];
                        if b == bb && g == bgc && r == br {
                            continue;
                        }
                        let dx = ox as usize + tx;
                        let dy = oy as usize + ty;
                        if dx >= fw as usize || dy >= fh as usize {
                            continue;
                        }
                        let (r2, g2, b2) = enhance_aa_pixel(
                            (r, g, b),
                            (fr, fgc, fb),
                            (mr2, mg2, mb2),
                            (br, bgc, bb),
                            TEXT_AA_POWER,
                        );
                        let di = (dy * dst_w + dx) * 4;
                        // 预乘：文字在本体上，用本体 alpha。
                        let a = body_a as f64 / 255.0;
                        buf[di] = (b2 as f64 * a).round() as u8;
                        buf[di + 1] = (g2 as f64 * a).round() as u8;
                        buf[di + 2] = (r2 as f64 * a).round() as u8;
                        buf[di + 3] = body_a;
                    }
                }
                SelectObject(tdc, old_t);
                DeleteObject(t_dib as _);
                DeleteDC(tdc);
            }

            let _ = update_layered(hwnd, mem, fw, fh);
            SelectObject(mem, old_bmp);
            DeleteObject(dib as _);
            DeleteDC(mem);
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
        let rest = (1852, 200, 68, 148);
        let h = hover_rect(rest, PinEdge::Right, 168);
        assert_eq!(h, (1752, 200, 168, 148));
        assert_eq!(h.0 + h.2 as i32, rest.0 + rest.2 as i32);
        let rest = (0, 80, 68, 148);
        let h = hover_rect(rest, PinEdge::Left, 168);
        assert_eq!(h, (0, 80, 168, 148));
    }

    #[test]
    fn contrast_fg_keeps_readable_colors_and_replaces_washed_ones() {
        assert_eq!(contrast_fg(0x002A170F, 0x00FAF5F5), 0x002A170F);
        assert!(wcag_contrast(0x002A170F, 0x00FAF5F5) >= 7.0);
        let fg = contrast_fg(0x00FFFFF8, 0x00FAF5F5);
        // 刚好 7:1 的替代色亮度约 83（BT.601）；用 WCAG 约束，不卡死旧的 80。
        assert!(colorref_luma(fg) < 100, "luma {}", colorref_luma(fg));
        assert!(
            wcag_contrast(fg, 0x00FAF5F5) >= 7.0,
            "replaced fg contrast {}",
            wcag_contrast(fg, 0x00FAF5F5)
        );
        assert_eq!(contrast_fg(0x00F3EEE8, 0x003A2A21), 0x00F3EEE8);
        let fg = contrast_fg(0x00201008, 0x003A2A21);
        assert!(colorref_luma(fg) > 170, "luma {}", colorref_luma(fg));
        assert!(wcag_contrast(fg, 0x003A2A21) >= 7.0);
    }

    #[test]
    fn contrast_meets_wcag_on_handle_body() {
        // 走查实测本体 (250, 252, 253) = COLORREF 0x00FDFCFA
        let body = 0x00FDFCFA;
        assert!((wcag_contrast(contrast_fg(0x00FFFFF8, body), body) - 7.0) >= -0.05);
        assert!(wcag_contrast(contrast_fg(0x002A170F, body), body) >= 7.0);
        // 主题 --text-muted #626e7c 在 5/8 启发式下看起来发灰；现在至少 4.5:1 且更深。
        let muted_theme = 0x007C6E62; // RGB 0x62,0x6e,0x7c
        let m = contrast_muted(muted_theme, body);
        let ratio = wcag_contrast(m, body);
        assert!(ratio >= 4.5, "muted contrast {ratio} on handle body");
        // 比主题原色更深（浅底上亮度更低）
        assert!(
            wcag_luminance(m) < wcag_luminance(muted_theme),
            "muted should be darker than theme #626e7c"
        );
        let m_dark = contrast_muted(0x00201008, 0x00201C1C);
        assert!(
            wcag_contrast(m_dark, 0x00201C1C) >= 4.5,
            "dark muted contrast {}",
            wcag_contrast(m_dark, 0x00201C1C)
        );
    }

    #[test]
    fn contrast_muted_stays_on_the_readable_side() {
        let bg = 0x00FAF5F5;
        let m = contrast_muted(0x00FFFFF8, bg);
        assert!(
            wcag_contrast(m, bg) >= 4.5,
            "light muted contrast {} vs bg",
            wcag_contrast(m, bg)
        );
        let bg = 0x003A2A21;
        let m = contrast_muted(0x00201008, bg);
        assert!(
            wcag_contrast(m, bg) >= 4.5,
            "dark muted contrast {} vs bg",
            wcag_contrast(m, bg)
        );
    }

    #[test]
    fn enhance_aa_darkens_mid_coverage_and_keeps_endpoints() {
        let fg = (41u8, 52, 67);
        let muted = (54u8, 60, 68);
        let bg = (250u8, 252, 253);
        assert_eq!(enhance_aa_pixel(fg, fg, muted, bg, TEXT_AA_POWER), fg);
        assert_eq!(enhance_aa_pixel(bg, fg, muted, bg, TEXT_AA_POWER), bg);
        // 走查实测的约 45% 覆盖率灰边 (156,162,169)，提升后应更靠近墨色。
        let fringe = (156u8, 162, 169);
        let out = enhance_aa_pixel(fringe, fg, muted, bg, TEXT_AA_POWER);
        let luma =
            |c: (u8, u8, u8)| 0.2126 * c.0 as f64 + 0.7152 * c.1 as f64 + 0.0722 * c.2 as f64;
        assert!(
            luma(out) < luma(fringe) - 20.0,
            "fringe should darken, got {:?} luma {} vs {}",
            out,
            luma(out),
            luma(fringe)
        );
        assert!(
            luma(out) > luma(fg),
            "must not overshoot past ink, got {:?}",
            out
        );
        // muted 线段上的灰边也归到 muted，而不是被拉成标题色。
        let mute_fringe = (
            ((muted.0 as u16 + bg.0 as u16) / 2) as u8,
            ((muted.1 as u16 + bg.1 as u16) / 2) as u8,
            ((muted.2 as u16 + bg.2 as u16) / 2) as u8,
        );
        let out_m = enhance_aa_pixel(mute_fringe, fg, muted, bg, TEXT_AA_POWER);
        assert!(luma(out_m) < luma(mute_fringe) - 10.0);
        assert!(luma(out_m) > luma(muted) - 4.0, "muted fringe {:?}", out_m);
    }

    #[test]
    fn frame_keeps_flush_edge_and_adds_shadow_elsewhere() {
        let card = (1852, 200, 68, 148);
        let f = frame_rect(card, true, 68);
        assert_eq!(f.0 + f.2 as i32, card.0 + card.2 as i32, "右缘仍贴齐");
        assert_eq!(shadow_margin(68), 10);
        assert_eq!(f, (1852 - 10, 200 - 10, 68 + 10, 148 + 20));
        let card = (0, 80, 68, 148);
        let f = frame_rect(card, false, 68);
        assert_eq!(f.0, 0, "左缘仍贴齐");
        assert_eq!(f, (0, 80 - 10, 68 + 10, 148 + 20));
        // 卡片尺寸本身不变（E2E handleRect）
        let (vis_rect_w, vis_rect_h) = (card.2, card.3);
        assert_eq!((vis_rect_w, vis_rect_h), (68, 148));
    }

    #[test]
    fn rounded_corners_are_antialiased_and_flush_side_is_square() {
        // 内侧圆角：角上覆盖率介于 0 与 1；贴边直角外侧覆盖率为 0。
        let r = 16.0;
        // 右缘贴边：左上圆角圆心在 (32, 32)，卡片内部取远离圆弧的点。
        let sd_inside = sd_round_rect(48.0, 60.0, 16.0, 16.0, 68.0, 148.0, r, 0.0, r, 0.0);
        assert!(sd_inside < -2.0, "内部 sd {sd_inside}");
        // 左上圆角外侧沿 45°
        let cx = 16.0 + r;
        let cy = 16.0 + r;
        let on_arc = sd_round_rect(
            cx - r * 0.707,
            cy - r * 0.707,
            16.0,
            16.0,
            68.0,
            148.0,
            r,
            0.0,
            r,
            0.0,
        );
        assert!(
            coverage(on_arc) > 0.2 && coverage(on_arc) < 0.9,
            "arc cov {}",
            coverage(on_arc)
        );
        // 贴边右上角是直角：刚好在矩形外 1px 覆盖率为 0
        let outside_flush = sd_round_rect(
            16.0 + 68.0 + 2.0,
            16.0 + 2.0,
            16.0,
            16.0,
            68.0,
            148.0,
            r,
            0.0,
            r,
            0.0,
        );
        assert_eq!(coverage(outside_flush), 0.0);
    }

    #[test]
    fn raster_body_is_nearly_opaque_shadow_is_outside_and_flush_is_clean() {
        let fw = 68 + 10;
        let fh = 148 + 20;
        let mut px = vec![0u8; fw * fh * 4];
        rasterize_handle(
            &mut px, fw as u32, fh as u32, 68, 148, true, 68, 0x00FCFAFA, 0x00666666, 0x00C0647D,
            BODY_ALPHA,
        );
        // 卡片中心：接近本体 alpha，不是 90% 那种会透图标的淡底。
        let (ox, oy) = card_origin_in_frame(true, 68);
        let cx = (ox + 34) as usize;
        let cy = (oy + 74) as usize;
        let a = px[(cy * fw + cx) * 4 + 3];
        assert!(a >= 245, "body alpha {a}, want >= 245");
        // 贴边右侧：是卡片本体，不是阴影，也不是 1px 灰描边发丝。
        let right = fw - 1;
        let mid = oy as usize + 74;
        let ri = (mid * fw + right) * 4;
        let ra = px[ri + 3];
        assert!(ra >= 245, "flush-edge pixel should be card, alpha {ra}");
        let (br, bgc, bb) = colorref_channels(0x00FCFAFA);
        let body_a = BODY_ALPHA as f64 / 255.0;
        let exp_r = (br as f64 * body_a).round() as i32;
        let exp_g = (bgc as f64 * body_a).round() as i32;
        let exp_b = (bb as f64 * body_a).round() as i32;
        // 缓冲是 BGRA
        let (pb, pg, pr) = (px[ri] as i32, px[ri + 1] as i32, px[ri + 2] as i32);
        assert!(
            (pr - exp_r).abs() < 12 && (pg - exp_g).abs() < 12 && (pb - exp_b).abs() < 12,
            "flush edge should be body, not a gray hairline: got RGB({pr},{pg},{pb}) want ~({exp_r},{exp_g},{exp_b})"
        );
        // 左侧阴影：紧贴卡片处峰值约 0.20（≤ 0.22*255≈56），外缘更淡；不再是 0.40 的闷晕。
        let sa_near = px[(mid * fw + (ox as usize).saturating_sub(2)) * 4 + 3];
        assert!(
            sa_near > 12 && sa_near < 70,
            "near-card shadow alpha {sa_near}, want ~0.18–0.22 peak (12–56) with a little headroom"
        );
        let sa_mid = px[(mid * fw + 4) * 4 + 3];
        assert!(
            sa_mid < sa_near,
            "shadow should fall off, mid {sa_mid} vs near {sa_near}"
        );
        // 阴影点击判定：边距里不是卡片。
        assert!(!hit_in_card(8, mid as i32, (ox, oy, 68, 148), true, 68));
        assert!(hit_in_card(ox + 34, oy + 74, (ox, oy, 68, 148), true, 68));
        // 圆角附近有介于 0 与满 alpha 之间的像素（抗锯齿，不是 SetWindowRgn 台阶）。
        let mut mid_alpha = 0;
        for y in (oy as usize)..(oy as usize + 20) {
            for x in (ox as usize)..(ox as usize + 20) {
                let a = px[(y * fw + x) * 4 + 3];
                if a > 20 && a < 200 {
                    mid_alpha += 1;
                }
            }
        }
        assert!(
            mid_alpha >= 8,
            "expected AA fringe, got {mid_alpha} mid-alpha pixels"
        );
    }
}

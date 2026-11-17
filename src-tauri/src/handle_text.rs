//! 探头把手的文字：DirectWrite 灰度抗锯齿，经 Direct2D 画进分层窗口用的预乘 BGRA 缓冲。
//!
//! 为什么不用 GDI `DrawTextW`：GDI 灰度 AA 只能画在不透明临时 DIB 上，再从颜色里猜覆盖率拷回，
//! 12px 中文发细发灰，且无法调 gamma。这里用 WIC 位图包住同一张缓冲（软件渲染，结果确定），
//! Direct2D 以 `D2D1_ALPHA_MODE_PREMULTIPLIED` 直接合成，文字用自定的渲染参数：
//! - 灰度 AA（分层 alpha 上 ClearType 会带彩边），ClearType 级别 0、平面像素几何；
//! - gamma 1.8（Windows 默认文字 gamma）与较高的灰度增强对比，让 13px 竖笔落到实墨；
//! - 网格对齐开启：小字号在 96 DPI 上竖横笔按像素对齐，不糊成两列半灰。
//!
//! 工厂按线程缓存（探头窗口过程在主线程）；字体缺失时 DirectWrite 走系统回退。

use crate::pin_strip::TextRun;
use std::cell::RefCell;
use windows::core::{w, Interface, Result};
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1Factory, D2D1_DRAW_TEXT_OPTIONS_CLIP,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_FEATURE_LEVEL_DEFAULT, D2D1_RENDER_TARGET_PROPERTIES,
    D2D1_RENDER_TARGET_TYPE_SOFTWARE, D2D1_RENDER_TARGET_USAGE_NONE,
    D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, IDWriteFactory2, IDWriteRenderingParams,
    IDWriteTextFormat, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD,
    DWRITE_GRID_FIT_MODE_ENABLED, DWRITE_MEASURING_MODE_NATURAL, DWRITE_PIXEL_GEOMETRY_FLAT,
    DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC, DWRITE_TEXT_METRICS, DWRITE_TRIMMING,
    DWRITE_TRIMMING_GRANULARITY_CHARACTER, DWRITE_WORD_WRAPPING_NO_WRAP,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICImagingFactory,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};

/// 文字 gamma（Windows 默认 1.8）
pub const TEXT_GAMMA: f32 = 1.8;
/// ClearType 增强对比（ClearType 级别为 0，仅作完整参数）
pub const TEXT_ENHANCED_CONTRAST: f32 = 0.5;
/// 灰度增强对比：系统默认约 1.0；探头小字在近白卡片上取更高一档，竖笔更实。
pub const TEXT_GRAYSCALE_CONTRAST: f32 = 1.6;

struct Factories {
    d2d: ID2D1Factory,
    dw: IDWriteFactory,
    wic: IWICImagingFactory,
    params: IDWriteRenderingParams,
}

thread_local! {
    static FACTORIES: RefCell<Option<Factories>> = const { RefCell::new(None) };
}

fn create_factories() -> Result<Factories> {
    // SAFETY：标准 COM / D2D / DWrite 工厂创建；返回的接口由 windows crate 引用计数。
    unsafe {
        // 主线程已由 Tauri 初始化 OLE（S_FALSE / RPC_E_CHANGED_MODE 均可忽略）；测试线程在此初始化。
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
        let dw: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let wic: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let params: IDWriteRenderingParams = match dw.cast::<IDWriteFactory2>() {
            Ok(f2) => f2
                .CreateCustomRenderingParams(
                    TEXT_GAMMA,
                    TEXT_ENHANCED_CONTRAST,
                    TEXT_GRAYSCALE_CONTRAST,
                    0.0,
                    DWRITE_PIXEL_GEOMETRY_FLAT,
                    DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC,
                    DWRITE_GRID_FIT_MODE_ENABLED,
                )?
                .cast()?,
            Err(_) => dw.CreateCustomRenderingParams(
                TEXT_GAMMA,
                TEXT_GRAYSCALE_CONTRAST,
                0.0,
                DWRITE_PIXEL_GEOMETRY_FLAT,
                DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC,
            )?,
        };
        Ok(Factories {
            d2d,
            dw,
            wic,
            params,
        })
    }
}

fn color_f(c: u32) -> D2D1_COLOR_F {
    D2D1_COLOR_F {
        r: (c & 0xff) as f32 / 255.0,
        g: ((c >> 8) & 0xff) as f32 / 255.0,
        b: ((c >> 16) & 0xff) as f32 / 255.0,
        a: 1.0,
    }
}

/// 一行文字的格式：雅黑 UI、单行、字符级省略号兜底。
fn text_format(f: &Factories, run: &TextRun) -> Result<IDWriteTextFormat> {
    unsafe {
        let weight = if run.semibold {
            DWRITE_FONT_WEIGHT_SEMI_BOLD
        } else {
            DWRITE_FONT_WEIGHT_NORMAL
        };
        let format = f.dw.CreateTextFormat(
            w!("Microsoft YaHei UI"),
            None,
            weight,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            run.px,
            w!("zh-cn"),
        )?;
        format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
        let sign = f.dw.CreateEllipsisTrimmingSign(&format)?;
        let trimming = DWRITE_TRIMMING {
            granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER,
            delimiter: 0,
            delimiterCount: 0,
        };
        format.SetTrimming(&trimming, &sign)?;
        Ok(format)
    }
}

/// 按真实字宽挑截断点（见 `pin_strip::ellipsize`）。
fn fit_run(f: &Factories, format: &IDWriteTextFormat, run: &TextRun) -> String {
    let (l, _, r, _) = run.rect;
    let avail = (r - l) as f32;
    crate::pin_strip::ellipsize(&run.text, &|s: &str| {
        text_width(f, format, s).is_some_and(|wd| wd <= avail)
    })
}

/// 单行排版宽度（DIP = 物理像素，渲染目标 96 DPI）。
fn text_width(f: &Factories, format: &IDWriteTextFormat, s: &str) -> Option<f32> {
    let wide: Vec<u16> = s.encode_utf16().collect();
    unsafe {
        let layout = f.dw.CreateTextLayout(&wide, format, 1.0e5, 1.0e4).ok()?;
        let mut m = DWRITE_TEXT_METRICS::default();
        layout.GetMetrics(&mut m).ok()?;
        Some(m.widthIncludingTrailingWhitespace)
    }
}

/// 把文字画进自上而下、stride = w×4 的预乘 BGRA 缓冲（已含卡片底）。
pub fn draw_runs(buf: &mut [u8], w: u32, h: u32, runs: &[TextRun]) -> Result<()> {
    let len = (w as usize) * (h as usize) * 4;
    if buf.len() < len || runs.is_empty() || w == 0 || h == 0 {
        return Ok(());
    }
    FACTORIES.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(create_factories()?);
        }
        let f = slot.as_ref().expect("factories just created");
        draw_with(f, &mut buf[..len], w, h, runs)
    })
}

fn draw_with(f: &Factories, buf: &mut [u8], w: u32, h: u32, runs: &[TextRun]) -> Result<()> {
    // SAFETY：WIC 位图从缓冲拷入、渲染、再整幅拷回；尺寸与 stride 一致。
    unsafe {
        let bmp = f
            .wic
            .CreateBitmapFromMemory(w, h, &GUID_WICPixelFormat32bppPBGRA, w * 4, buf)?;
        let props = D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_SOFTWARE,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            // 缓冲本身就是设备像素：96 DPI 让 1 DIP = 1 像素，缩放已由排版按 DPI 折算。
            dpiX: 96.0,
            dpiY: 96.0,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        };
        let rt = f.d2d.CreateWicBitmapRenderTarget(&bmp, &props)?;
        rt.BeginDraw();
        rt.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
        rt.SetTextRenderingParams(&f.params);
        for run in runs {
            let format = text_format(f, run)?;
            let brush = rt.CreateSolidColorBrush(&color_f(run.color), None)?;
            let (l, t, r, b) = run.rect;
            let rect = D2D_RECT_F {
                left: l as f32,
                top: t as f32,
                right: r as f32,
                bottom: b as f32,
            };
            // 自己挑截断点（不停在分隔符上），DirectWrite 的字符级裁切只作兜底。
            let fitted = fit_run(f, &format, run);
            let text: Vec<u16> = fitted.encode_utf16().collect();
            rt.DrawText(
                &text,
                &format,
                &rect,
                &brush,
                D2D1_DRAW_TEXT_OPTIONS_CLIP,
                DWRITE_MEASURING_MODE_NATURAL,
            );
        }
        rt.EndDraw(None, None)?;
        bmp.CopyPixels(std::ptr::null(), w * 4, buf)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pin_strip::{
        card_origin_in_frame, contrast_fg, contrast_muted, contrast_name, handle_text_runs,
        rasterize_handle, shadow_margin, wcag_contrast, PeekContent, BODY_ALPHA,
    };

    struct Theme {
        name: &'static str,
        bg: u32,
        fg: u32,
        muted: u32,
        stripe: u32,
    }

    const LIGHT: Theme = Theme {
        name: "light",
        bg: 0x00FCFAFA,
        fg: 0x0028231F,
        muted: 0x007C6E62,
        stripe: 0x007D64C0,
    };
    const DARK: Theme = Theme {
        name: "dark",
        bg: 0x00201C1C,
        fg: 0x00F3EEE8,
        muted: 0x00A09A94,
        stripe: 0x007D64C0,
    };

    fn pack(r: u8, g: u8, b: u8) -> u32 {
        r as u32 | ((g as u32) << 8) | ((b as u32) << 16)
    }

    /// 预乘 BGRA → 直通 RGBA
    fn unpremul(px: &[u8], i: usize) -> (u8, u8, u8, u8) {
        let a = px[i + 3];
        if a == 0 {
            return (0, 0, 0, 0);
        }
        let u = |c: u8| ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8;
        (u(px[i + 2]), u(px[i + 1]), u(px[i]), a)
    }

    struct Frame {
        px: Vec<u8>,
        w: u32,
        h: u32,
        runs: Vec<TextRun>,
    }

    fn render(t: &Theme, scale: f64, hover: bool) -> Frame {
        render_names(
            t,
            scale,
            hover,
            &["设计稿 v3.fig", "季度报告.docx", "截图 2026-11-13.png"],
        )
    }

    fn render_names(t: &Theme, scale: f64, hover: bool, names: &[&str]) -> Frame {
        let rest_w = (68.0 * scale).round() as u32;
        let card_w = if hover {
            (168.0 * scale).round() as u32
        } else {
            rest_w
        };
        let card_h = (148.0 * scale).round() as u32;
        let m = shadow_margin(rest_w) as u32;
        let (w, h) = (card_w + m, card_h + 2 * m);
        let mut px = vec![0u8; (w * h * 4) as usize];
        let muted = contrast_muted(t.muted, t.bg);
        rasterize_handle(
            &mut px, w, h, card_w, card_h, true, rest_w, t.bg, muted, t.stripe, BODY_ALPHA,
        );
        let peek = PeekContent {
            title: "工作".into(),
            count: 7,
            names: names.iter().map(|n| n.to_string()).collect(),
            stripe: None,
        };
        let (ox, oy) = card_origin_in_frame(true, rest_w);
        let runs = handle_text_runs(
            &peek,
            contrast_fg(t.fg, t.bg),
            muted,
            contrast_name(t.muted, t.bg),
            ox,
            oy,
            card_w,
            card_h,
            scale,
        );
        draw_runs(&mut px, w, h, &runs).expect("DirectWrite 绘制");
        Frame { px, w, h, runs }
    }

    fn write_png(f: &Frame, file: &str) {
        let dir = std::env::var_os("TL_HANDLE_SHOTS_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("tl-handle-shots"));
        std::fs::create_dir_all(&dir).expect("shots dir");
        let mut rgba = Vec::with_capacity(f.px.len());
        for i in (0..f.px.len()).step_by(4) {
            let (r, g, b, a) = unpremul(&f.px, i);
            rgba.extend_from_slice(&[r, g, b, a]);
        }
        let file = std::fs::File::create(dir.join(file)).expect("png file");
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), f.w, f.h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().expect("png header");
        wr.write_image_data(&rgba).expect("png data");
    }

    /// 一行文字的墨色统计：(最高对比度, 达到 `solid` 对比度的像素数)
    fn ink(f: &Frame, run: &TextRun, bg: u32, solid: f64) -> (f64, usize) {
        let (l, t, r, b) = run.rect;
        let mut best: f64 = 1.0;
        let mut n = 0;
        for y in t.max(0)..b.min(f.h as i32) {
            for x in l.max(0)..r.min(f.w as i32) {
                let i = ((y as u32 * f.w + x as u32) * 4) as usize;
                let (pr, pg, pb, a) = unpremul(&f.px, i);
                // 文字不在卡片上打洞：本体 alpha 保持（顶部高光 / 描边之外）
                assert!(
                    a >= BODY_ALPHA - 6,
                    "alpha {a} at ({x},{y}) in {:?}",
                    run.text
                );
                let c = wcag_contrast(pack(pr, pg, pb), bg);
                best = best.max(c);
                if c >= solid {
                    n += 1;
                }
            }
        }
        (best, n)
    }

    #[test]
    fn offscreen_handle_text_reads_solid_at_100_125_150_percent() {
        for t in [&LIGHT, &DARK] {
            for (scale, tag) in [(1.0, "100"), (1.25, "125"), (1.5, "150")] {
                for hover in [false, true] {
                    let f = render(t, scale, hover);
                    let state = if hover { "hover" } else { "rest" };
                    write_png(&f, &format!("handle-{}-{tag}-{state}.png", t.name));
                    assert_eq!(f.runs.len(), 5, "{} {tag} {state}", t.name);
                    let area = scale * scale;
                    for (k, run) in f.runs.iter().enumerate() {
                        let (best, solid) = ink(&f, run, t.bg, 4.5);
                        // 标题与文件名行：竖笔要落到接近实墨（颜色本身 ≥ 7:1）；「N 项」≥ 4.5:1。
                        let want = if k == 1 { 4.5 } else { 6.5 };
                        assert!(
                            best >= want,
                            "{} {tag} {state} row {k} {:?}: peak contrast {best:.2} < {want}",
                            t.name,
                            run.text
                        );
                        // 不是零星一两个深点：每行至少有一截实墨笔画
                        let min_solid = ((if k == 1 { 8.0 } else { 20.0 }) * area) as usize;
                        assert!(
                            solid >= min_solid,
                            "{} {tag} {state} row {k} {:?}: {solid} px ≥ 4.5:1, want ≥ {min_solid}",
                            t.name,
                            run.text
                        );
                    }
                    // 预乘合法：每个通道不超过 alpha
                    for i in (0..f.px.len()).step_by(4) {
                        let a = f.px[i + 3];
                        assert!(f.px[i] <= a && f.px[i + 1] <= a && f.px[i + 2] <= a);
                    }
                }
            }
        }
    }

    #[test]
    fn handle_truncation_never_ends_on_separator_with_real_glyph_widths() {
        let names = [
            "发票-某某科技-已付款.pdf",
            "report_final_v2.docx",
            "项目 · 设计稿 · 终版.psd",
        ];
        for t in [&LIGHT, &DARK] {
            for (scale, tag) in [(1.0, "100"), (1.25, "125"), (1.5, "150")] {
                for hover in [false, true] {
                    let f = render_names(t, scale, hover, &names);
                    let state = if hover { "hover" } else { "rest" };
                    write_png(&f, &format!("handle-trunc-{}-{tag}-{state}.png", t.name));
                    FACTORIES.with(|cell| {
                        let slot = cell.borrow();
                        let fx = slot.as_ref().expect("render 已创建工厂");
                        for run in &f.runs[2..] {
                            let format = text_format(fx, run).expect("format");
                            let out = fit_run(fx, &format, run);
                            let (l, _, r, _) = run.rect;
                            let wd = text_width(fx, &format, &out).expect("width");
                            assert!(
                                wd <= (r - l) as f32,
                                "{tag} {state} {out:?} {wd} > {}",
                                r - l
                            );
                            if let Some(body) = out.strip_suffix('…') {
                                assert!(
                                    !body.ends_with(crate::pin_strip::is_cut_separator),
                                    "{tag} {state}: {out:?}"
                                );
                                let meaningful = body
                                    .chars()
                                    .filter(|c| !crate::pin_strip::is_cut_separator(*c))
                                    .count();
                                assert!(meaningful >= 2, "{tag} {state}: {out:?}");
                            }
                            eprintln!("{} {tag} {state}: {:?} -> {out:?}", t.name, run.text);
                        }
                    });
                }
            }
        }
    }
}

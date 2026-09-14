//! Windows Shell 图像提取：经 IShellItemImageFactory 获取系统缩略图或关联图标，
//! 保留透明通道并使用 GDI+ 编码为 PNG。缩略图和图标采用独立请求模式。
//! windows-sys 0.59 未内置 IShellItemImageFactory 接口定义，此处按 COM vtable 布局
//! 手工声明（IUnknown 三方法 + GetImage）。

#![cfg(target_os = "windows")]

use std::path::Path;
use std::sync::Mutex;
use windows_sys::core::{GUID, HRESULT, PCWSTR};
use windows_sys::Win32::Foundation::SIZE;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows_sys::Win32::Graphics::GdiPlus::{
    GdipCreateBitmapFromHICON, GdipCreateBitmapFromScan0, GdipDisposeImage, GdipSaveImageToFile,
    GdiplusShutdown, GdiplusStartup, GdiplusStartupInput, GpBitmap, GpImage, PixelFormatAlpha,
    PixelFormatGDI, PixelFormatPAlpha,
};
use windows_sys::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows_sys::Win32::UI::Shell::{
    SHCreateItemFromParsingName, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
    SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY, SIIGBF_THUMBNAILONLY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

/// IID_IShellItemImageFactory
const IID_SHELL_ITEM_IMAGE_FACTORY: GUID = GUID {
    data1: 0xBCC18B79,
    data2: 0xBA16,
    data3: 0x442F,
    data4: [0x80, 0xC4, 0x8A, 0x59, 0xC3, 0x0C, 0x46, 0x3B],
};

/// PNG 编码器 CLSID（GDI+ 内置）
const CLSID_PNG_ENCODER: GUID = GUID {
    data1: 0x557CF406,
    data2: 0x1A04,
    data3: 0x11D3,
    data4: [0x9A, 0x73, 0x00, 0x00, 0xF8, 0x1E, 0xF3, 0x2E],
};

/// COM 已在调用线程以其他套间模型初始化（无需、也不允许 CoUninitialize）
const RPC_E_CHANGED_MODE: HRESULT = -2147417850; // 0x80010106

/// 缩略图请求边长（与资源管理器大图标视图一致）
const THUMB_SIZE: i32 = 256;
static SHELL_IMAGE_LOCK: Mutex<()> = Mutex::new(());

#[repr(C)]
struct IShellItemImageFactory {
    lp_vtbl: *const IShellItemImageFactoryVtbl,
}

#[repr(C)]
struct IShellItemImageFactoryVtbl {
    // IUnknown（本实现只调 Release；前两个槽位保留占位）
    query_interface: *const core::ffi::c_void,
    add_ref: *const core::ffi::c_void,
    release: unsafe extern "system" fn(*mut IShellItemImageFactory) -> u32,
    // IShellItemImageFactory
    get_image: unsafe extern "system" fn(
        *mut IShellItemImageFactory,
        SIZE,
        i32, // SIIGBF
        *mut HBITMAP,
    ) -> HRESULT,
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 提取 path 的系统缩略图并保存为 PNG。取不到缩略图或任一步骤失败时返回 Err。
pub fn save_shell_thumbnail_png(input_path: &str, output_path: &Path) -> Result<(), String> {
    save_shell_image_png(input_path, output_path, THUMB_SIZE, SIIGBF_THUMBNAILONLY)
}

/// 提取关联图标，直接访问系统图标缓存和处理器。
pub fn save_shell_icon_png(input_path: &str, output_path: &Path) -> Result<(), String> {
    save_shell_image_png(input_path, output_path, 128, SIIGBF_ICONONLY)
}

fn save_shell_image_png(
    input_path: &str,
    output_path: &Path,
    size: i32,
    flags: i32,
) -> Result<(), String> {
    // Shell 图像处理器顺序访问，成品通过同目录重命名一次发布。
    let _guard = SHELL_IMAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let pending = output_path.with_extension(format!("{}.pending", std::process::id()));
    unsafe {
        // Shell 缩略图处理器按 STA 编写；每调用线程初始化一次，函数尾配对释放
        let coinit = CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        );
        let should_uninit = coinit == 0 || coinit == 1; // S_OK / S_FALSE
        if coinit < 0 && coinit != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx 失败: 0x{coinit:08x}"));
        }

        let result = save_shell_image_png_inner(input_path, &pending, size, flags)
            .map_err(|error| format!("{error} (COM: 0x{coinit:08x})"));

        if should_uninit {
            CoUninitialize();
        }
        let result = result.and_then(|_| {
            std::fs::rename(&pending, output_path)
                .map_err(|error| format!("发布系统图像失败: {error}"))
        });
        if result.is_err() {
            match std::fs::remove_file(&pending) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => eprintln!("[icons] 清理临时图像失败: {error}"),
            }
        }
        result
    }
}

unsafe fn save_shell_image_png_inner(
    input_path: &str,
    output_path: &Path,
    size: i32,
    flags: i32,
) -> Result<(), String> {
    let path_wide = to_wide(input_path);
    let mut factory: *mut IShellItemImageFactory = std::ptr::null_mut();
    let hr = SHCreateItemFromParsingName(
        path_wide.as_ptr() as PCWSTR,
        std::ptr::null_mut(),
        &IID_SHELL_ITEM_IMAGE_FACTORY,
        &mut factory as *mut _ as *mut *mut core::ffi::c_void,
    );
    if hr < 0 || factory.is_null() {
        return Err(format!("SHCreateItemFromParsingName 失败: 0x{hr:08x}"));
    }

    let result = extract_and_save(factory, output_path, size, flags);

    let vtbl = (*factory).lp_vtbl;
    ((*vtbl).release)(factory);
    if flags == SIIGBF_ICONONLY {
        // 图像工厂可能仍在异步准备图标；关联图标接口提供同步可用的系统图像。
        result.or_else(|primary| {
            save_file_icon_png(input_path, output_path)
                .map_err(|fallback| format!("{primary}; {fallback}"))
        })
    } else {
        result
    }
}

unsafe fn save_file_icon_png(input_path: &str, output_path: &Path) -> Result<(), String> {
    let mut info: SHFILEINFOW = std::mem::zeroed();
    let result = SHGetFileInfoW(
        to_wide(input_path).as_ptr(),
        0,
        &mut info,
        std::mem::size_of::<SHFILEINFOW>() as u32,
        SHGFI_ICON | SHGFI_LARGEICON,
    );
    if result == 0 || info.hIcon.is_null() {
        return Err("关联图标不可用".to_string());
    }
    let saved = save_icon_as_png(info.hIcon, output_path);
    DestroyIcon(info.hIcon);
    saved
}

unsafe fn save_icon_as_png(icon: HICON, output_path: &Path) -> Result<(), String> {
    let mut info: ICONINFO = std::mem::zeroed();
    if GetIconInfo(icon, &mut info) == 0 {
        return Err("读取关联图标像素失败".to_string());
    }
    let result = (|| {
        if info.hbmColor.is_null() {
            return save_gdiplus_png(
                |bitmap| GdipCreateBitmapFromHICON(icon, bitmap),
                output_path,
            );
        }
        let (width, height, mut pixels) = read_bitmap_pixels(info.hbmColor)?;
        // 传统图标通过 AND 掩码表达透明区域，32 位图标保留原有 alpha。
        if pixels.chunks_exact(4).all(|pixel| pixel[3] == 0) {
            let (mask_width, mask_height, mask) = read_bitmap_pixels(info.hbmMask)?;
            if mask_width != width || mask_height < height {
                return Err("图标掩码尺寸不匹配".to_string());
            }
            for (pixel, mask_pixel) in pixels.chunks_exact_mut(4).zip(mask.chunks_exact(4)) {
                if mask_pixel[0] != 0 {
                    pixel.fill(0);
                } else {
                    pixel[3] = 255;
                }
            }
        }
        save_pixels_as_png(width, height, width * 4, &pixels, output_path)
    })();
    if !info.hbmColor.is_null() {
        DeleteObject(info.hbmColor);
    }
    if !info.hbmMask.is_null() {
        DeleteObject(info.hbmMask);
    }
    result
}

unsafe fn extract_and_save(
    factory: *mut IShellItemImageFactory,
    output_path: &Path,
    size: i32,
    flags: i32,
) -> Result<(), String> {
    let mut hbmp: HBITMAP = std::ptr::null_mut();
    let hr = ((*(*factory).lp_vtbl).get_image)(
        factory,
        SIZE { cx: size, cy: size },
        flags | SIIGBF_BIGGERSIZEOK,
        &mut hbmp,
    );
    if hr < 0 || hbmp.is_null() {
        if !hbmp.is_null() {
            DeleteObject(hbmp);
        }
        return Err(format!("无可用系统图像: 0x{hr:08x}"));
    }

    let result = save_hbitmap_as_png(hbmp, output_path);
    DeleteObject(hbmp);
    result
}

unsafe fn read_bitmap_pixels(hbmp: HBITMAP) -> Result<(i32, i32, Vec<u8>), String> {
    let mut info: BITMAP = std::mem::zeroed();
    if GetObjectW(
        hbmp,
        std::mem::size_of::<BITMAP>() as i32,
        &mut info as *mut _ as *mut _,
    ) == 0
    {
        return Err("读取系统图像尺寸失败".to_string());
    }
    let width = info.bmWidth;
    let height = info.bmHeight.checked_abs().ok_or("系统图像高度无效")?;
    if !(1..=4096).contains(&width) || !(1..=4096).contains(&height) {
        return Err("系统图像尺寸超出支持范围".to_string());
    }
    let stride = width * 4;
    let mut pixels = vec![0u8; (stride * height) as usize];
    let mut dib: BITMAPINFO = std::mem::zeroed();
    dib.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..std::mem::zeroed()
    };
    let dc = CreateCompatibleDC(std::ptr::null_mut());
    if dc.is_null() {
        return Err("创建图像读取上下文失败".to_string());
    }
    let lines = GetDIBits(
        dc,
        hbmp,
        0,
        height as u32,
        pixels.as_mut_ptr() as *mut _,
        &mut dib,
        DIB_RGB_COLORS,
    );
    DeleteDC(dc);
    if lines != height {
        return Err("读取系统图像像素失败".to_string());
    }
    Ok((width, height, pixels))
}

unsafe fn save_hbitmap_as_png(hbmp: HBITMAP, output_path: &Path) -> Result<(), String> {
    let (width, height, mut pixels) = read_bitmap_pixels(hbmp)?;
    // 无 alpha 的位图使用不透明通道；Shell 的透明图标保留预乘 BGRA。
    if pixels.chunks_exact(4).all(|pixel| pixel[3] == 0) {
        for pixel in pixels.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }
    save_pixels_as_png(width, height, width * 4, &pixels, output_path)
}

unsafe fn save_pixels_as_png(
    width: i32,
    height: i32,
    stride: i32,
    pixels: &[u8],
    output_path: &Path,
) -> Result<(), String> {
    let pixel_format =
        (11 | (32 << 8) | PixelFormatAlpha | PixelFormatPAlpha | PixelFormatGDI) as i32;
    save_gdiplus_png(
        |bitmap| {
            GdipCreateBitmapFromScan0(width, height, stride, pixel_format, pixels.as_ptr(), bitmap)
        },
        output_path,
    )
}

unsafe fn save_gdiplus_png(
    create_bitmap: impl FnOnce(*mut *mut GpBitmap) -> i32,
    output_path: &Path,
) -> Result<(), String> {
    let mut token: usize = 0;
    let input = GdiplusStartupInput {
        GdiplusVersion: 1,
        DebugEventCallback: 0,
        SuppressBackgroundThread: 0,
        SuppressExternalCodecs: 0,
    };
    let status = GdiplusStartup(&mut token, &input, std::ptr::null_mut());
    if status != 0 {
        return Err(format!("GdiplusStartup 失败: {status}"));
    }

    let result = (|| {
        let mut bitmap: *mut GpBitmap = std::ptr::null_mut();
        let status = create_bitmap(&mut bitmap);
        if status != 0 || bitmap.is_null() {
            return Err(format!("创建 PNG 源图像失败: {status}"));
        }

        let out_wide = to_wide(&output_path.to_string_lossy());
        let status = GdipSaveImageToFile(
            bitmap as *mut GpImage,
            out_wide.as_ptr() as PCWSTR,
            &CLSID_PNG_ENCODER,
            std::ptr::null(),
        );
        GdipDisposeImage(bitmap as *mut GpImage);
        if status != 0 {
            return Err(format!("GdipSaveImageToFile 失败: {status}"));
        }
        Ok(())
    })();

    GdiplusShutdown(token);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parallel_icon_requests_publish_complete_png() {
        let dir = std::env::temp_dir().join(format!("tl-parallel-icons-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("并发图标.txt");
        let output = dir.join("shared.png");
        std::fs::write(&input, b"native image fixture").unwrap();
        let barrier = std::sync::Barrier::new(4);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let input = &input;
                let output = &output;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    save_shell_icon_png(&input.to_string_lossy(), output).unwrap();
                    let bytes = std::fs::read(output).unwrap();
                    assert!(bytes.len() > 100);
                    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
                });
            }
        });
        assert!(!output
            .with_extension(format!("{}.pending", std::process::id()))
            .exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn png_preserves_pixel_orientation_and_alpha() {
        use windows_sys::Win32::Graphics::Gdi::CreateDIBSection;
        use windows_sys::Win32::Graphics::GdiPlus::{GdipBitmapGetPixel, GdipCreateBitmapFromFile};
        let output = std::env::temp_dir().join(format!("tl-alpha-{}.png", std::process::id()));
        unsafe {
            let mut dib: BITMAPINFO = std::mem::zeroed();
            dib.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: 2,
                biHeight: -2,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            };
            let mut bits = std::ptr::null_mut();
            let bitmap = CreateDIBSection(
                std::ptr::null_mut(),
                &dib,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            assert!(!bitmap.is_null());
            let pixels = [0u8, 0, 128, 128, 0, 0, 0, 0, 0, 255, 0, 255, 255, 0, 0, 255];
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
            let saved = save_hbitmap_as_png(bitmap, &output);
            DeleteObject(bitmap);
            saved.unwrap();

            let mut token = 0;
            let input = GdiplusStartupInput {
                GdiplusVersion: 1,
                ..std::mem::zeroed()
            };
            assert_eq!(GdiplusStartup(&mut token, &input, std::ptr::null_mut()), 0);
            let mut decoded = std::ptr::null_mut();
            assert_eq!(
                GdipCreateBitmapFromFile(to_wide(&output.to_string_lossy()).as_ptr(), &mut decoded),
                0
            );
            let mut actual = Vec::new();
            for (x, y) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let mut pixel = 0;
                assert_eq!(GdipBitmapGetPixel(decoded, x, y, &mut pixel), 0);
                actual.push(pixel);
            }
            GdipDisposeImage(decoded as *mut GpImage);
            GdiplusShutdown(token);
            assert_eq!(actual, [0x80ff0000, 0, 0xff00ff00, 0xff0000ff]);
        }
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn shell_icons_support_directories_and_missing_paths_fail() {
        let dir = std::env::temp_dir().join(format!("tl-shell-icon-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("folder.png");
        save_shell_icon_png(&dir.to_string_lossy(), &output).unwrap();
        assert_eq!(&std::fs::read(&output).unwrap()[..8], b"\x89PNG\r\n\x1a\n");
        let missing = dir.join("missing.png");
        assert!(save_shell_icon_png(&dir.join("absent.exe").to_string_lossy(), &missing).is_err());
        assert!(!missing.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// 真机冒烟：从真实视频提取系统缩略图并校验 PNG 落盘。
    /// 默认取仓库内素材（不存在时跳过）；可用 TL_THUMB_SMOKE 指定其他文件。
    /// 运行：cargo test shell_thumbnail -- --ignored
    #[test]
    #[ignore = "需要本机真实视频文件与 Windows Shell 环境"]
    fn extracts_thumbnail_from_real_video() {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let default_video = manifest.join("../视频素材/自定义扩展.mp4");
        let input = std::env::var("TL_THUMB_SMOKE")
            .map(std::path::PathBuf::from)
            .unwrap_or(default_video);
        if !input.exists() {
            eprintln!("跳过：测试视频不存在 {}", input.display());
            return;
        }

        let output = std::env::temp_dir().join("taglauncher-thumb-smoke.png");
        let _ = std::fs::remove_file(&output);

        super::save_shell_thumbnail_png(&input.to_string_lossy(), &output).expect("提取系统缩略图");

        let bytes = std::fs::read(&output).expect("读取缩略图 PNG");
        assert!(
            bytes.len() > 1000,
            "PNG 体积异常小（疑似空白）: {}",
            bytes.len()
        );
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "输出必须是合法 PNG");
        let _ = std::fs::remove_file(&output);
    }
}

//! Win11 原生系统背景（DWMWA_SYSTEMBACKDROP_TYPE）。
//!
//! 快速搜索窗与钉住浮动窗共用同一个 WebView 窗口。在 build ≥ 22621 上使用
//! `DWMSBT_TRANSIENTWINDOW`（瞬态亚克力：系统自己的亮度、着色与噪点配方），
//! 配 `DWMWA_USE_IMMERSIVE_DARK_MODE` 跟随主题、`DWMWCP_ROUND` 由合成器画圆角和阴影。
//!
//! 这不是旧的 `SetWindowCompositionAttribute` / Tauri `Effect::Acrylic`：那套叠在白底主窗上
//! 会读成浑浊灰卡片。不支持时返回 false，由前端用干净实底回退，绝不走浑浊灰路径。
//!
//! API 全部经 GetProcAddress 调用，不增加 Cargo feature；失败即视为不支持。

#![cfg(windows)]

use std::ffi::c_void;
use std::sync::OnceLock;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED,
};

/// Windows 11 22H2：DWMWA_SYSTEMBACKDROP_TYPE 从这一版起可用。
const MIN_BUILD: u32 = 22621;

const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;

const DWMSBT_NONE: u32 = 1;
const DWMSBT_TRANSIENTWINDOW: u32 = 3;
const DWMWCP_ROUND: u32 = 2;

#[repr(C)]
struct OsVersionInfoW {
    size: u32,
    major: u32,
    minor: u32,
    build: u32,
    platform: u32,
    csd: [u16; 128],
}

#[repr(C)]
struct Margins {
    left: i32,
    right: i32,
    top: i32,
    bottom: i32,
}

type RtlGetVersionFn = unsafe extern "system" fn(*mut OsVersionInfoW) -> i32;
type DwmSetAttrFn = unsafe extern "system" fn(HWND, u32, *const c_void, u32) -> i32;
type DwmExtendFn = unsafe extern "system" fn(HWND, *const Margins) -> i32;

struct DwmApi {
    set_attr: DwmSetAttrFn,
    extend: DwmExtendFn,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn proc_addr(h: windows_sys::Win32::Foundation::HMODULE, name: &[u8]) -> *const std::ffi::c_void {
    // windows-sys 0.59 的 FARPROC 是 Option<fn()>；转成指针再判空，兼容旧的 *mut c_void。
    let proc = unsafe { GetProcAddress(h, name.as_ptr() as _) };
    unsafe { std::mem::transmute(proc) }
}


fn nt_build() -> u32 {
    // SAFETY：ntdll 常驻；RtlGetVersion 写调用方提供的结构体。
    unsafe {
        let ntdll = GetModuleHandleW(wide("ntdll.dll").as_ptr());
        if ntdll.is_null() {
            return 0;
        }
        let proc = proc_addr(ntdll, b"RtlGetVersion\0");
        if proc.is_null() {
            return 0;
        }
        let f: RtlGetVersionFn = std::mem::transmute(proc);
        let mut info = OsVersionInfoW {
            size: std::mem::size_of::<OsVersionInfoW>() as u32,
            major: 0,
            minor: 0,
            build: 0,
            platform: 0,
            csd: [0; 128],
        };
        if f(&mut info) != 0 {
            return 0;
        }
        info.build
    }
}

fn api() -> Option<&'static DwmApi> {
    static API: OnceLock<Option<DwmApi>> = OnceLock::new();
    API.get_or_init(|| {
        // SAFETY：系统 DLL；函数签名与 dwmapi 文档一致。
        unsafe {
            let lib = LoadLibraryW(wide("dwmapi.dll").as_ptr());
            if lib.is_null() {
                return None;
            }
            let set_attr = proc_addr(lib, b"DwmSetWindowAttribute\0");
            let extend = proc_addr(lib, b"DwmExtendFrameIntoClientArea\0");
            if set_attr.is_null() || extend.is_null() {
                return None;
            }
            Some(DwmApi {
                set_attr: std::mem::transmute(set_attr),
                extend: std::mem::transmute(extend),
            })
        }
    })
    .as_ref()
}

/// 本机是否支持系统瞬态背景。
pub fn supported() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| api().is_some() && nt_build() >= MIN_BUILD)
}

fn set_attr(hwnd: HWND, attr: u32, value: &u32) -> bool {
    let Some(api) = api() else {
        return false;
    };
    // SAFETY：hwnd 是本进程窗口；value 在调用期间有效。
    unsafe { (api.set_attr)(hwnd, attr, value as *const u32 as *const c_void, 4) == 0 }
}

fn extend_frame(hwnd: HWND, margins: Margins) -> bool {
    let Some(api) = api() else {
        return false;
    };
    unsafe { (api.extend)(hwnd, &margins) == 0 }
}

/// 去掉 Tauri `transparent(true)` 可能带上的 `WS_EX_LAYERED`：系统背景与分层窗口互斥。
fn clear_layered(hwnd: HWND) {
    unsafe {
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_LAYERED != 0 {
            SetWindowLongW(hwnd, GWL_EXSTYLE, (ex & !WS_EX_LAYERED) as i32);
        }
    }
}

/// 开启瞬态亚克力、沉浸式深色、合成器圆角。失败返回 false，调用方走干净实底。
pub fn apply(hwnd: isize, dark: bool) -> bool {
    if hwnd == 0 || !supported() {
        return false;
    }
    let h = hwnd as HWND;
    clear_layered(h);
    // 客户区全部作为 DWM 画框，背景才能透出来。
    if !extend_frame(
        h,
        Margins {
            left: -1,
            right: -1,
            top: -1,
            bottom: -1,
        },
    ) {
        return false;
    }
    let dark_v = if dark { 1u32 } else { 0 };
    let _ = set_attr(h, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark_v);
    let _ = set_attr(h, DWMWA_WINDOW_CORNER_PREFERENCE, &DWMWCP_ROUND);
    set_attr(h, DWMWA_SYSTEMBACKDROP_TYPE, &DWMSBT_TRANSIENTWINDOW)
}

/// 只更新深色模式（窗口已在显示、背景已打开时跟随主题切换）。
pub fn set_dark(hwnd: isize, dark: bool) {
    if hwnd == 0 || !supported() {
        return;
    }
    let dark_v = if dark { 1u32 } else { 0 };
    let _ = set_attr(hwnd as HWND, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark_v);
}

/// 隐藏时关掉系统背景，避免 DWM 在不可见窗口上继续合成（空闲 CPU）。
pub fn clear(hwnd: isize) {
    if hwnd == 0 || !supported() {
        return;
    }
    let h = hwnd as HWND;
    let _ = set_attr(h, DWMWA_SYSTEMBACKDROP_TYPE, &DWMSBT_NONE);
    let _ = extend_frame(
        h,
        Margins {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
        },
    );
}

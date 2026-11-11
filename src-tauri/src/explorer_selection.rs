//! 热键 B「收纳资源管理器选中项」：读取前台资源管理器窗口（或桌面）当前选中的文件系统路径。
//!
//! 走 Shell 自动化：IShellWindows 枚举资源管理器窗口 → 顶层 HWND 与前台窗口相同的那一个
//! （Win11 多标签时取可见的那个标签）→ IShellBrowser → 当前视图 IFolderView2::GetSelection。
//! 前台是桌面（Progman / WorkerW）时用 FindWindowSW(SWC_DESKTOP) 取桌面视图。
//! 必须在 STA 线程里调用（本模块自己 CoInitializeEx）。跨完整性级别（本程序以管理员运行而
//! 资源管理器不是）时 COM 调用会失败，返回错误，由调用方降级。

/// 读取 `foreground` 这个顶层窗口对应的资源管理器选中项（文件系统路径；虚拟项如「此电脑」跳过）。
#[cfg(windows)]
pub fn selection_of(foreground: isize) -> Result<Vec<String>, String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IServiceProvider,
        CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Shell::{
        IFolderView2, IShellBrowser, IShellWindows, IWebBrowserApp, SID_STopLevelBrowser,
        ShellWindows, SIGDN_FILESYSPATH, SWC_DESKTOP, SWFO_NEEDDISPATCH,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, IsWindowVisible};

    // SAFETY：本函数内完成 COM 初始化与反初始化；所有 COM 对象在 CoUninitialize 前离开作用域
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Vec<String>> {
            let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)?;
            let fg = HWND(foreground as *mut core::ffi::c_void);
            let mut class = [0u16; 64];
            let n = GetClassNameW(fg, &mut class).max(0) as usize;
            let class = String::from_utf16_lossy(&class[..n]);

            let browser_of = |disp: windows::Win32::System::Com::IDispatch| -> windows::core::Result<IShellBrowser> {
                let sp: IServiceProvider = disp.cast()?;
                sp.QueryService::<IShellBrowser>(&SID_STopLevelBrowser)
            };

            let mut browser: Option<IShellBrowser> = None;
            if matches!(class.as_str(), "Progman" | "WorkerW") {
                let loc = VARIANT::from(0i32); // CSIDL_DESKTOP
                let root = VARIANT::default();
                let mut hwnd = 0i32;
                let disp =
                    windows.FindWindowSW(&loc, &root, SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)?;
                browser = Some(browser_of(disp)?);
            } else {
                let count = windows.Count()?;
                let mut fallback = None;
                for i in 0..count {
                    let Ok(disp) = windows.Item(&VARIANT::from(i)) else {
                        continue;
                    };
                    let Ok(app) = disp.cast::<IWebBrowserApp>() else {
                        continue;
                    };
                    let Ok(h) = app.HWND() else { continue };
                    if h.0 as isize != foreground {
                        continue;
                    }
                    let Ok(b) = browser_of(disp) else { continue };
                    // Win11 多标签：同一顶层窗口有多个条目，选可见的标签
                    let visible = b
                        .GetWindow()
                        .map(|w| IsWindowVisible(w).as_bool())
                        .unwrap_or(false);
                    if visible {
                        browser = Some(b);
                        break;
                    }
                    fallback.get_or_insert(b);
                }
                if browser.is_none() {
                    browser = fallback;
                }
            }
            let Some(browser) = browser else {
                return Ok(Vec::new());
            };
            let view: IFolderView2 = browser.QueryActiveShellView()?.cast()?;
            let items = match view.GetSelection(false) {
                Ok(items) => items,
                Err(_) => return Ok(Vec::new()), // 没有选中项
            };
            let mut out = Vec::new();
            for i in 0..items.GetCount()? {
                let item = items.GetItemAt(i)?;
                if let Ok(p) = item.GetDisplayName(SIGDN_FILESYSPATH) {
                    if let Ok(s) = p.to_string() {
                        out.push(s);
                    }
                    CoTaskMemFree(Some(p.0 as *const core::ffi::c_void));
                }
            }
            Ok(out)
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| format!("读取资源管理器选中项失败：{e}"))
    }
}

#[cfg(not(windows))]
pub fn selection_of(_foreground: isize) -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// 当前前台顶层窗口（热键回调里第一时间取，避免之后弹窗改变前台）
#[cfg(windows)]
pub fn foreground_window() -> isize {
    // SAFETY：无参数查询
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
}

#[cfg(not(windows))]
pub fn foreground_window() -> isize {
    0
}

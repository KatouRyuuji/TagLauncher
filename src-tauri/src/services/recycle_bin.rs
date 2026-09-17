//! 把文件或文件夹移到系统回收站（可从资源管理器还原）。
//!
//! Windows 走 `SHFileOperationW(FO_DELETE + FOF_ALLOWUNDO)`，与资源管理器「删除」
//! 同口径，避免 `fs::remove_file` 那种不可恢复的直接抹盘。

/// 将路径移到回收站。目标不存在时视为已经消失，返回成功，便于「删源文件」
/// 与库记录清理走同一条成功路径。
pub fn move_to_recycle_bin(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let location = std::path::Path::new(trimmed);
    if !location.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        move_to_recycle_bin_windows(location)
    }

    #[cfg(not(windows))]
    {
        let _ = location;
        Err("当前平台不支持将本地文件移到回收站".to_string())
    }
}

#[cfg(windows)]
fn move_to_recycle_bin_windows(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        SHFILEOPSTRUCTW,
    };

    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    // SHFileOperationW 要求 pFrom 以双 NUL 结尾（单路径也一样）。
    from.push(0);
    from.push(0);

    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };

    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 {
        return Err(format!("无法移到回收站（错误码 {code}）"));
    }
    if op.fAnyOperationsAborted != 0 {
        return Err("移到回收站被取消".to_string());
    }
    Ok(())
}

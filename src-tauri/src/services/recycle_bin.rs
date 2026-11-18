//! 把文件或文件夹移到系统回收站（可从资源管理器还原）。
//!
//! Windows 走 `IFileOperation` + `FOFX_RECYCLEONDELETE`：无法回收时操作失败，
//! 源文件保持原位，不做永久删除。`FOF_ALLOWUNDO` 单独不足以保证仅回收，
//! 也不得用 `FOF_WANTNUKEWARNING` 把「可能永久删除」当成仅回收。

use std::path::Path;

/// 将路径移到回收站。目标不存在时视为已经消失，返回成功，便于「删源文件」
/// 与库记录清理走同一条成功路径。无法保证仅回收时返回错误，不删除源文件。
pub fn move_to_recycle_bin(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    assess_recycle_eligibility(trimmed)?;
    let location = Path::new(trimmed);
    if !location.exists() {
        return Ok(());
    }

    #[cfg(test)]
    if let Some(result) = test_hook_run(trimmed) {
        return result;
    }

    #[cfg(windows)]
    {
        return move_to_recycle_bin_windows(location);
    }

    #[cfg(not(windows))]
    {
        let _ = location;
        Err("当前平台不支持将本地文件移到回收站".to_string())
    }
}

/// 预检：路径是否具备「仅回收站删除」的资格。失败时不得调用删除 API。
/// 跨平台可测：空路径、UNC/网络路径、回收站自身。Windows 另检卷类型。
pub fn assess_recycle_eligibility(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let normalized = trimmed.replace('/', "\\");
    let lower = normalized.to_ascii_lowercase();
    if is_unc_or_network_path(&lower) {
        return Err("网络路径无法移到回收站，已取消删除以免永久丢失".to_string());
    }
    if lower.contains(r"\$recycle.bin\") || lower.ends_with(r"\$recycle.bin") {
        return Err("不能对回收站路径执行回收删除".to_string());
    }
    Ok(())
}

/// `\\server\share`、`\\?\UNC\server\share` 为网络路径；`\\?\C:\` 是本地扩展前缀，不是 UNC。
fn is_unc_or_network_path(lower: &str) -> bool {
    if lower.starts_with(r"\\?\unc\") {
        return true;
    }
    if lower.starts_with(r"\\?\") {
        return false;
    }
    lower.starts_with(r"\\")
}

#[cfg(windows)]
fn volume_allows_recycle(path: &Path) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    // windows-sys 0.59 未再导出这些常量；取值与 Win32 GetDriveTypeW 一致。
    const DRIVE_UNKNOWN: u32 = 0;
    const DRIVE_NO_ROOT_DIR: u32 = 1;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_CDROM: u32 = 5;

    let Some(root) = volume_root(path) else {
        return Err("无法确定文件所在卷，已取消删除以免永久丢失".to_string());
    };
    let mut wide: Vec<u16> = std::os::windows::ffi::OsStrExt::encode_wide(root.as_os_str()).collect();
    if !wide.last().is_some_and(|c| *c == 0) {
        wide.push(0);
    }
    let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
    if matches!(
        drive_type,
        DRIVE_REMOTE | DRIVE_CDROM | DRIVE_UNKNOWN | DRIVE_NO_ROOT_DIR
    ) {
        return Err("该位置无法移到回收站，已取消删除以免永久丢失".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn volume_root(path: &Path) -> Option<std::path::PathBuf> {
    let mut cur = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    // 盘符根（C:\）或 UNC 根无法再取 parent 的有效根时停止。
    loop {
        match cur.parent() {
            Some(parent) if parent != cur => {
                if parent.as_os_str().is_empty() {
                    break;
                }
                cur = parent.to_path_buf();
            }
            _ => break,
        }
    }
    Some(cur)
}

#[cfg(windows)]
fn move_to_recycle_bin_windows(path: &Path) -> Result<(), String> {
    volume_allows_recycle(path)?;
    match recycle_with_ifile_operation(path) {
        Err(e) if is_com_apartment_mismatch(&e) => recycle_on_sta_thread(path),
        other => other,
    }
}

#[cfg(windows)]
fn is_com_apartment_mismatch(err: &str) -> bool {
    err.contains("RPC_E_CHANGED_MODE") || err.contains("0x80010106")
}

#[cfg(windows)]
fn recycle_on_sta_thread(path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("tl-recycle".into())
        .spawn(move || {
            let _ = tx.send(recycle_with_ifile_operation(&path));
        })
        .map_err(|e| format!("无法启动回收站操作线程：{e}"))?;
    rx.recv()
        .map_err(|_| "回收站操作线程已退出".to_string())?
}

#[cfg(windows)]
fn recycle_with_ifile_operation(path: &Path) -> Result<(), String> {
    use windows::core::{GUID, HRESULT, HSTRING, Interface};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        IFileOperation, IShellItem, SHCreateItemFromParsingName,
        FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
    };

    // windows 0.62 未再导出 CLSID_FileOperation；GUID 来自官方 IFileOperation 类标识。
    const CLSID_FILE_OPERATION: GUID =
        GUID::from_u128(0x3ad05575_8857_4850_9277_11b85bdb8e09);
    const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x8001_0106u32 as i32);

    struct ComGuard {
        uninit: bool,
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.uninit {
                unsafe { CoUninitialize() };
            }
        }
    }

    // CoInitializeEx 在 windows 0.62 返回 HRESULT（S_FALSE 表示本线程已初始化，不可再 Uninitialize）。
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if hr.is_err() {
        if hr == RPC_E_CHANGED_MODE {
            return Err(format!("RPC_E_CHANGED_MODE：{hr}"));
        }
        return Err(format!("无法初始化回收站组件：{hr}"));
    }
    let _com = ComGuard { uninit: hr.0 == 0 };

    let ops: IFileOperation = unsafe {
        CoCreateInstance(&CLSID_FILE_OPERATION, None, CLSCTX_ALL)
            .map_err(|e| format!("无法创建回收站操作：{e}"))?
    };
    // FOFX_RECYCLEONDELETE：不能回收则失败，源文件保持原位。
    let flags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT | FOFX_RECYCLEONDELETE;
    unsafe {
        ops.SetOperationFlags(flags)
            .map_err(|e| format!("无法设置回收站操作标志：{e}"))?;
    }

    let item: IShellItem = unsafe {
        SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)
            .map_err(|e| format!("无法打开待回收项：{e}"))?
    };
    unsafe {
        ops.DeleteItem(&item, None)
            .map_err(|e| format!("无法加入回收站删除：{e}"))?;
        ops.PerformOperations()
            .map_err(|e| format!("无法移到回收站：{e}"))?;
    }
    let aborted = unsafe { ops.GetAnyOperationsAborted() }
        .map_err(|e| format!("无法确认回收站操作状态：{e}"))?
        .as_bool();
    if aborted {
        return Err("移到回收站被取消".to_string());
    }
    if path.exists() {
        return Err("未能移到回收站，源文件仍在原位".to_string());
    }
    Ok(())
}

#[cfg(test)]
thread_local! {
    static TEST_HOOK: std::cell::Cell<Option<fn(&str) -> Result<(), String>>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn test_hook_run(path: &str) -> Option<Result<(), String>> {
    TEST_HOOK.with(|hook| hook.get().map(|f| f(path)))
}

#[cfg(test)]
pub(crate) fn with_recycle_hook<F, R>(hook: fn(&str) -> Result<(), String>, f: F) -> R
where
    F: FnOnce() -> R,
{
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            TEST_HOOK.with(|hook| hook.set(None));
        }
    }
    TEST_HOOK.with(|cell| cell.set(Some(hook)));
    let _guard = Guard;
    f()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligibility_rejects_empty_and_network_and_recycle_bin() {
        assert!(assess_recycle_eligibility("").unwrap_err().contains("不能为空"));
        assert!(assess_recycle_eligibility("   ").unwrap_err().contains("不能为空"));
        assert!(assess_recycle_eligibility(r"\\server\share\file.exe")
            .unwrap_err()
            .contains("网络路径"));
        assert!(assess_recycle_eligibility(r"\\?\UNC\server\share\file.exe")
            .unwrap_err()
            .contains("网络路径"));
        assert!(assess_recycle_eligibility(r"C:\$Recycle.Bin\S-1-5-18\file")
            .unwrap_err()
            .contains("回收站"));
        // 本地扩展前缀不是网络路径
        assert!(assess_recycle_eligibility(r"\\?\C:\Users\a\file.exe").is_ok());
        assert!(assess_recycle_eligibility(r"C:\Users\a\file.exe").is_ok());
        assert!(assess_recycle_eligibility(r"D:/docs/report.pdf").is_ok());
    }

    #[test]
    fn missing_path_is_already_gone_success() {
        let err_or_ok = move_to_recycle_bin(r"D:\__tl_test_recycle_missing__\gone.exe");
        assert_eq!(err_or_ok, Ok(()));
    }

    #[test]
    fn hook_failure_does_not_claim_success() {
        fn deny(_: &str) -> Result<(), String> {
            Err("回收站不可用（测试）".to_string())
        }
        let dir = std::env::temp_dir().join(format!("tl_recycle_hook_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("keep.bin");
        std::fs::write(&file, b"keep").unwrap();
        let path = file.to_string_lossy().to_string();
        let result = with_recycle_hook(deny, || move_to_recycle_bin(&path));
        assert!(result.unwrap_err().contains("回收站不可用"));
        assert!(file.exists(), "失败不得删除源文件");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

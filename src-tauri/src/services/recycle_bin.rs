//! 把文件或文件夹移到系统回收站（可从资源管理器还原）。
//!
//! Windows 走 `IFileOperation` + `FOFX_RECYCLEONDELETE`，并配合删除前的
//! `IFileOperationProgressSink::PreDeleteItem` 拒绝：官方文档写明 PreDeleteItem
//! 返回错误即取消该删除及后续排队操作。`FOF_NOCONFIRMATION` 会把对话框自动答成
//! Yes，不能用来保证只回收。`FOF_NOERRORUI` 必须搭配 `FOFX_EARLYFAILURE`，否则
//! 错误会被当成 Continue。超配额等仍可能在 PreDelete 之后静默永久删除，故删除前
//! 还要用回收站容量预检；无法证明安全时返回错误、不发起删除、保留库记录。
//! 不得用 `FOF_WANTNUKEWARNING` 把「可能永久删除」当成仅回收。

use std::path::Path;

/// 将路径移到回收站。目标不存在时视为已经消失，返回成功，便于「删源文件」
/// 与库记录清理走同一条成功路径。无法保证仅回收时返回错误，不删除源文件。
pub fn move_to_recycle_bin(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    assess_recycle_eligibility(trimmed)?;
    let location = Path::new(trimmed);
    if path_is_definitely_missing(location)? {
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

/// 官方 TRANSFER_SOURCE_FLAGS：该位未置上表示此次删除不会进入回收站。
/// 见 IFileOperationProgressSink::PreDeleteItem 与 TRANSFER_SOURCE_FLAGS。
pub const TSF_DELETE_RECYCLE_IF_POSSIBLE: u32 = 0x80;

/// IFileOperation 标志取值与 Win32 SDK 一致；FOF_NOCONFIRMATION 不得加入，
/// 因为它会把「永久删除」对话框自动答成 Yes。
pub const FOF_SILENT: u32 = 0x0004;
pub const FOF_NOCONFIRMATION: u32 = 0x0010;
pub const FOF_ALLOWUNDO: u32 = 0x0040;
pub const FOFX_EARLYFAILURE: u32 = 0x0010_0000;
pub const FOF_NOCONFIRMMKDIR: u32 = 0x0000_0200;
pub const FOF_NOERRORUI: u32 = 0x0400;
pub const FOFX_RECYCLEONDELETE: u32 = 0x00080000;

/// 仅回收操作允许使用的标志组合：不能回收则失败，错误不 Continue，不自动确认永久删除。
pub fn recycle_operation_flags() -> u32 {
    FOF_ALLOWUNDO | FOF_NOERRORUI | FOF_SILENT | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE
}

/// CoInitializeEx 成功（含 S_FALSE / 值为 1）必须配对 CoUninitialize。
pub fn com_init_requires_uninit(hr: i32) -> bool {
    hr >= 0
}

/// 注册表 DWORD 读取结果：缺失与格式/类型错误必须区分，二者都不能当成“可回收”。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistryDword {
    Missing,
    Invalid,
    Value(u32),
}

/// 官方 REG_DWORD = 4；ERROR_FILE_NOT_FOUND = 2。仅成功且类型、长度都正确才取值。
pub const REG_DWORD: u32 = 4;
pub const ERROR_FILE_NOT_FOUND: i32 = 2;

pub fn interpret_registry_dword(
    status: i32,
    ty: u32,
    data_len: u32,
    data: [u8; 4],
) -> RegistryDword {
    if status == ERROR_FILE_NOT_FOUND {
        return RegistryDword::Missing;
    }
    if status != 0 || ty != REG_DWORD || data_len != 4 {
        return RegistryDword::Invalid;
    }
    RegistryDword::Value(u32::from_le_bytes(data))
}

/// 回收站注册表：仅当 NukeOnDelete 明确为 0 且 MaxCapacity 为正（单位 MB）时给出上限。
/// 缺失、类型错误、未知 Nuke 值一律拒绝，不得按默许容量放行。
pub fn recycle_max_from_registry(
    nuke_on_delete: RegistryDword,
    max_capacity_mb: RegistryDword,
) -> Result<i64, String> {
    match nuke_on_delete {
        RegistryDword::Value(0) => {}
        _ => return Err("回收站已关闭或删除策略未知，已取消删除以免永久丢失".to_string()),
    }
    match max_capacity_mb {
        RegistryDword::Value(mb) if mb > 0 => Ok((mb as i64) * 1024 * 1024),
        _ => Err("回收站容量未知，已取消删除以免永久丢失".to_string()),
    }
}

/// 删除前策略：缺少「尽可能回收」标志时必须中止，不能让操作降级为永久删除。
pub fn predelete_must_abort(dw_flags: u32) -> bool {
    dw_flags & TSF_DELETE_RECYCLE_IF_POSSIBLE == 0
}

/// 回收站查询结果。max <= 0 视为无法证明可回收（关闭或查询无效）。
#[derive(Clone, Copy, Debug)]
pub struct RecycleCapacity {
    pub used: i64,
    pub max: i64,
}

/// 对象大于剩余容量时拒绝。无法确认容量时同样拒绝，不发起可能永久删除的调用。
pub fn assess_recycle_capacity(needed_bytes: u64, cap: RecycleCapacity) -> Result<(), String> {
    if cap.max <= 0 {
        return Err("回收站容量未知或已关闭，已取消删除以免永久丢失".to_string());
    }
    let remaining = cap.max.saturating_sub(cap.used.max(0));
    if (needed_bytes as i128) > remaining as i128 {
        return Err("对象超过回收站剩余容量，已取消删除以免永久丢失".to_string());
    }
    Ok(())
}

pub fn interpret_try_exists(result: Result<bool, std::io::Error>) -> Result<bool, String> {
    match result {
        Ok(exists) => Ok(!exists),
        Err(e) => Err(format!("无法确认文件是否存在：{e}")),
    }
}

/// 只有确定不存在才算已消失。权限或 IO 错误不得当成 NotFound。
pub fn path_is_definitely_missing(path: &Path) -> Result<bool, String> {
    interpret_try_exists(path.try_exists())
}

fn path_tree_size(path: &Path) -> Result<u64, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("无法读取待回收对象大小：{e}"))?;
    if meta.is_file() {
        return Ok(meta.len());
    }
    if !meta.is_dir() {
        return Ok(meta.len());
    }
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let entries =
            std::fs::read_dir(&cur).map_err(|e| format!("无法统计待回收目录大小：{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("无法统计待回收目录大小：{e}"))?;
            let meta = entry
                .metadata()
                .map_err(|e| format!("无法统计待回收目录大小：{e}"))?;
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total = total.saturating_add(meta.len());
            }
        }
    }
    Ok(total)
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
    let mut wide: Vec<u16> =
        std::os::windows::ffi::OsStrExt::encode_wide(root.as_os_str()).collect();
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
fn query_recycle_capacity(path: &Path) -> Result<RecycleCapacity, String> {
    let used = query_recycle_used(path)?;
    let max = query_recycle_max_bytes(path)?;
    Ok(RecycleCapacity { used, max })
}

/// 官方 SHQUERYRBINFO 仅有已用空间与项目数，不含上限。
#[repr(C)]
struct ShQueryRbInfo {
    cb_size: u32,
    size: i64,
    num_items: i64,
}

fn query_recycle_used(path: &Path) -> Result<i64, String> {
    use windows_sys::Win32::UI::Shell::SHQueryRecycleBinW;

    let Some(root) = volume_root(path) else {
        return Err("无法确定文件所在卷，已取消删除以免永久丢失".to_string());
    };
    let mut wide: Vec<u16> =
        std::os::windows::ffi::OsStrExt::encode_wide(root.as_os_str()).collect();
    if !wide.last().is_some_and(|c| *c == 0) {
        wide.push(0);
    }
    let mut info = ShQueryRbInfo {
        cb_size: std::mem::size_of::<ShQueryRbInfo>() as u32,
        size: 0,
        num_items: 0,
    };
    let hr =
        unsafe { SHQueryRecycleBinW(wide.as_ptr(), &mut info as *mut ShQueryRbInfo as *mut _) };
    if hr != 0 {
        return Err("无法查询回收站占用，已取消删除以免永久丢失".to_string());
    }
    Ok(info.size.max(0))
}

fn query_recycle_max_bytes(path: &Path) -> Result<i64, String> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumeNameForVolumeMountPointW;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ,
    };

    let Some(root) = volume_root(path) else {
        return Err("无法确定文件所在卷，已取消删除以免永久丢失".to_string());
    };
    let mut root_wide: Vec<u16> =
        std::os::windows::ffi::OsStrExt::encode_wide(root.as_os_str()).collect();
    if !root_wide.last().is_some_and(|c| *c == 0) {
        root_wide.push(0);
    }
    let mut volume = [0u16; 80];
    let ok = unsafe {
        GetVolumeNameForVolumeMountPointW(
            root_wide.as_ptr(),
            volume.as_mut_ptr(),
            volume.len() as u32,
        )
    };
    if ok == 0 {
        return Err("无法确定卷标识，已取消删除以免永久丢失".to_string());
    }
    let volume = String::from_utf16_lossy(&volume)
        .trim_end_matches('\0')
        .to_string();
    // GetVolumeNameForVolumeMountPointW 返回 \\?\Volume{GUID}\
    let guid = volume
        .rsplit_once("Volume")
        .map(|(_, rest)| rest.trim_matches('\\'))
        .filter(|s| s.starts_with('{') && s.ends_with('}'))
        .ok_or_else(|| "无法解析卷 GUID，已取消删除以免永久丢失".to_string())?;

    let subkey =
        format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\{guid}");
    let mut subkey_wide: Vec<u16> = subkey.encode_utf16().collect();
    subkey_wide.push(0);
    let mut hkey = std::ptr::null_mut();
    let open = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey_wide.as_ptr(),
            0,
            KEY_READ,
            &mut hkey,
        )
    };
    if open != 0 || hkey.is_null() {
        return Err("无法读取回收站容量设置，已取消删除以免永久丢失".to_string());
    }
    struct KeyGuard(*mut core::ffi::c_void);
    impl Drop for KeyGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { RegCloseKey(self.0) };
            }
        }
    }
    let _guard = KeyGuard(hkey);

    let read_dword = |name: &str| -> RegistryDword {
        let mut name_wide: Vec<u16> = name.encode_utf16().collect();
        name_wide.push(0);
        let mut data = [0u8; 4];
        let mut data_len = data.len() as u32;
        let mut ty = 0u32;
        let st = unsafe {
            RegQueryValueExW(
                hkey,
                name_wide.as_ptr(),
                std::ptr::null(),
                &mut ty,
                data.as_mut_ptr(),
                &mut data_len,
            )
        };
        interpret_registry_dword(st as i32, ty, data_len, data)
    };
    recycle_max_from_registry(read_dword("NukeOnDelete"), read_dword("MaxCapacity"))
}

#[cfg(windows)]
fn move_to_recycle_bin_windows(path: &Path) -> Result<(), String> {
    volume_allows_recycle(path)?;
    let needed = path_tree_size(path)?;
    let cap = query_recycle_capacity(path)?;
    assess_recycle_capacity(needed, cap)?;
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
    rx.recv().map_err(|_| "回收站操作线程已退出".to_string())?
}

#[cfg(windows)]
fn recycle_with_ifile_operation(path: &Path) -> Result<(), String> {
    use windows::core::{GUID, HRESULT, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        IFileOperation, IFileOperationProgressSink, IShellItem, SHCreateItemFromParsingName,
    };

    // windows 0.62 未再导出 CLSID_FileOperation；GUID 来自官方 IFileOperation 类标识。
    const CLSID_FILE_OPERATION: GUID = GUID::from_u128(0x3ad05575_8857_4850_9277_11b85bdb8e09);
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

    // CoInitializeEx 返回 HRESULT。S_OK 与 S_FALSE 都算成功，都必须配对 CoUninitialize。
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if hr.is_err() {
        if hr == RPC_E_CHANGED_MODE {
            return Err(format!("RPC_E_CHANGED_MODE：{hr}"));
        }
        return Err(format!("无法初始化回收站组件：{hr}"));
    }
    let _com = ComGuard {
        uninit: com_init_requires_uninit(hr.0),
    };

    let ops: IFileOperation = unsafe {
        CoCreateInstance(&CLSID_FILE_OPERATION, None, CLSCTX_ALL)
            .map_err(|e| format!("无法创建回收站操作：{e}"))?
    };
    // 不设 FOF_NOCONFIRMATION：该标志会把永久删除确认自动答成 Yes。
    // FOFX_EARLYFAILURE + FOF_NOERRORUI：错误必须失败，不能被当成 Continue。
    // 使用锁定的 windows 0.62 FILEOPERATION_FLAGS 常量，不用手写 u32 传入。
    {
        use windows::Win32::UI::Shell::{
            FOFX_EARLYFAILURE as SDK_FOFX_EARLYFAILURE,
            FOFX_RECYCLEONDELETE as SDK_FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO as SDK_FOF_ALLOWUNDO,
            FOF_NOERRORUI as SDK_FOF_NOERRORUI, FOF_SILENT as SDK_FOF_SILENT,
        };
        debug_assert_eq!(SDK_FOFX_EARLYFAILURE.0, FOFX_EARLYFAILURE);
        debug_assert_eq!(SDK_FOFX_RECYCLEONDELETE.0, FOFX_RECYCLEONDELETE);
        debug_assert_eq!(SDK_FOF_ALLOWUNDO.0, FOF_ALLOWUNDO);
        debug_assert_eq!(SDK_FOF_NOERRORUI.0, FOF_NOERRORUI);
        debug_assert_eq!(SDK_FOF_SILENT.0, FOF_SILENT);
        unsafe {
            ops.SetOperationFlags(
                SDK_FOF_ALLOWUNDO
                    | SDK_FOF_NOERRORUI
                    | SDK_FOF_SILENT
                    | SDK_FOFX_RECYCLEONDELETE
                    | SDK_FOFX_EARLYFAILURE,
            )
            .map_err(|e| format!("无法设置回收站操作标志：{e}"))?;
        }
    }

    let item: IShellItem = unsafe {
        SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)
            .map_err(|e| format!("无法打开待回收项：{e}"))?
    };
    let sink: IFileOperationProgressSink = RecycleOnlySink.into();
    unsafe {
        ops.DeleteItem(&item, Some(&sink))
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
    if !path_is_definitely_missing(path)? {
        return Err("未能移到回收站，源文件仍在原位".to_string());
    }
    Ok(())
}

/// 官方 IFileOperationProgressSink：PreDeleteItem 返回错误即取消该删除及后续操作。
/// 缺少 TSF_DELETE_RECYCLE_IF_POSSIBLE 时拒绝，避免降级为永久删除。
#[cfg(windows)]
#[windows::core::implement(windows::Win32::UI::Shell::IFileOperationProgressSink)]
struct RecycleOnlySink;

#[cfg(windows)]
impl windows::Win32::UI::Shell::IFileOperationProgressSink_Impl for RecycleOnlySink_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, _hrresult: windows::core::HRESULT) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreRenameItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostRenameItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _hrrename: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psidestinationfolder: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostMoveItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psidestinationfolder: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _hrmove: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psidestinationfolder: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostCopyItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psidestinationfolder: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _hrcopy: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreDeleteItem(
        &self,
        dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
    ) -> windows::core::Result<()> {
        if predelete_must_abort(dwflags) {
            // E_ABORT：取消本次删除及后续排队操作，不降级为永久删除。
            return Err(windows::core::Error::from(windows::core::HRESULT(
                0x8000_4004u32 as i32,
            )));
        }
        Ok(())
    }
    fn PostDeleteItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _hrdelete: windows::core::HRESULT,
        _psinewlycreated: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreNewItem(
        &self,
        _dwflags: u32,
        _psidestinationfolder: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostNewItem(
        &self,
        _dwflags: u32,
        _psidestinationfolder: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
        _psznewname: &windows::core::PCWSTR,
        _psztemplatename: &windows::core::PCWSTR,
        _dwfileattributes: u32,
        _hrnew: windows::core::HRESULT,
        _psinewitem: windows::core::Ref<windows::Win32::UI::Shell::IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
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
        assert!(assess_recycle_eligibility("")
            .unwrap_err()
            .contains("不能为空"));
        assert!(assess_recycle_eligibility("   ")
            .unwrap_err()
            .contains("不能为空"));
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

    #[test]
    fn recycle_flags_fail_closed_without_autoconfirm() {
        // 与 Win32 / windows 0.62 SDK 数值对照，禁止再用错误的 0x200 自证。
        assert_eq!(FOFX_EARLYFAILURE, 0x0010_0000);
        assert_eq!(FOF_NOCONFIRMMKDIR, 0x0000_0200);
        let flags = recycle_operation_flags();
        assert_eq!(flags & FOF_NOCONFIRMATION, 0, "不得自动 Yes 永久删除确认");
        assert_eq!(
            flags & FOF_NOCONFIRMMKDIR,
            0,
            "0x200 是 NOCONFIRMMKDIR，不是 EARLYFAILURE"
        );
        assert_eq!(flags & FOFX_RECYCLEONDELETE, FOFX_RECYCLEONDELETE);
        assert_eq!(flags & FOFX_EARLYFAILURE, FOFX_EARLYFAILURE);
        assert_eq!(flags & FOF_NOERRORUI, FOF_NOERRORUI);
        assert_eq!(flags & FOF_ALLOWUNDO, FOF_ALLOWUNDO);
    }

    #[test]
    fn predelete_aborts_when_recycle_flag_missing() {
        assert!(predelete_must_abort(0));
        assert!(predelete_must_abort(0x0001));
        assert!(!predelete_must_abort(TSF_DELETE_RECYCLE_IF_POSSIBLE));
        assert!(!predelete_must_abort(
            TSF_DELETE_RECYCLE_IF_POSSIBLE | 0x0001
        ));
    }

    #[test]
    fn capacity_preflight_rejects_overflow_and_unknown() {
        let cap = RecycleCapacity { used: 80, max: 100 };
        assert!(assess_recycle_capacity(20, cap).is_ok());
        assert!(assess_recycle_capacity(21, cap).is_err());
        assert!(assess_recycle_capacity(1, RecycleCapacity { used: 0, max: 0 }).is_err());
        assert!(assess_recycle_capacity(1, RecycleCapacity { used: 0, max: -1 }).is_err());
        assert!(assess_recycle_capacity(0, RecycleCapacity { used: 10, max: 10 }).is_ok());
        assert!(
            recycle_max_from_registry(RegistryDword::Value(1), RegistryDword::Value(4096)).is_err()
        );
        assert_eq!(
            recycle_max_from_registry(RegistryDword::Value(0), RegistryDword::Value(10)).unwrap(),
            10 * 1024 * 1024
        );
        assert!(recycle_max_from_registry(RegistryDword::Missing, RegistryDword::Missing).is_err());
        assert!(
            recycle_max_from_registry(RegistryDword::Value(0), RegistryDword::Value(0)).is_err()
        );
        assert!(
            recycle_max_from_registry(RegistryDword::Missing, RegistryDword::Value(100)).is_err(),
            "Nuke 缺失不得按正容量放行"
        );
        assert!(
            recycle_max_from_registry(RegistryDword::Value(2), RegistryDword::Value(10)).is_err()
        );
        assert!(
            recycle_max_from_registry(RegistryDword::Invalid, RegistryDword::Value(10)).is_err()
        );
        assert_eq!(
            interpret_registry_dword(0, REG_DWORD, 4, 10u32.to_le_bytes()),
            RegistryDword::Value(10)
        );
        assert_eq!(
            interpret_registry_dword(ERROR_FILE_NOT_FOUND, REG_DWORD, 4, [0; 4]),
            RegistryDword::Missing
        );
        assert_eq!(
            interpret_registry_dword(0, 3, 4, 10u32.to_le_bytes()),
            RegistryDword::Invalid,
            "非 DWORD 即使长度为 4 也必须拒绝"
        );
    }

    #[test]
    fn try_exists_errors_are_not_treated_as_missing() {
        let tmp = std::env::temp_dir().join(format!(
            "tl_recycle_exists_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&tmp);
        assert!(path_is_definitely_missing(&tmp).unwrap());
        std::fs::write(&tmp, b"keep").unwrap();
        assert!(!path_is_definitely_missing(&tmp).unwrap());
        let _ = std::fs::remove_file(&tmp);
        let err = interpret_try_exists(Err(std::io::Error::from(
            std::io::ErrorKind::PermissionDenied,
        )))
        .unwrap_err();
        assert!(err.contains("无法确认文件是否存在"), "{err}");
    }

    #[test]
    fn successful_com_init_including_s_false_requires_uninit() {
        assert!(com_init_requires_uninit(0));
        assert!(com_init_requires_uninit(1), "S_FALSE 也必须 CoUninitialize");
        assert!(!com_init_requires_uninit(0x8001_0106u32 as i32));
    }
}

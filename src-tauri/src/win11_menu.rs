//! Win11 一级右键菜单（实验，默认关闭）：未签名稀疏包 + IExplorerCommand 进程外 COM
//! （源码 shell-ext/win11-menu，构建 scripts/prepare-win11-menu.mjs）。
//!
//! CI 实测（win11-menu-probe.yml；Win11 26100 x64 / 26200 arm64，开发者模式强制关）：
//! - `Add-AppxPackage -Path <msix> -ExternalLocation <程序目录> -AllowUnsigned`：Publisher 末尾带
//!   Unsigned OID，不需要证书、不导入任何根证书、不改系统全局注册表；Win10 / Server 2022
//!   （20348）拒绝（0x80073D2B），所以要求 build ≥ 22000。
//! - **须管理员权限**：系统里尚无人注册时，非提权进程注册报 0x80073D19「an unsigned package cannot
//!   include Executable activations」（去掉 Application@Executable 也只换成「not a valid unsigned
//!   package」）；与微软文档「含可执行内容的未签名包须管理员为全体用户安装」一致。所以：
//!   已提权（或 UAC 关闭的管理员）直接注册；UAC 受限的管理员经 `runas` 弹一次 UAC 再注册；
//!   标准用户账户只有在包已被管理员暂存时才能注册，否则给出明确原因。移除自己的注册不需要提权。
//! - 菜单项由 dllhost 代理进程里的 DLL 提供，dllhost 带包标识：子进程须经桌面 explorer 启动
//!   （DLL 内实现），否则 TagLauncher 会继承包标识；清单同时关闭 AppData/注册表写虚拟化兜底。
//! - `Remove-AppxPackage` 后菜单即时消失，PackagedCom 键与 DLL 文件锁一并释放，无 HKCU 残留。
//!
//! 意图存设置 `shell.win11_menu`（"1" 开）：安装/升级前 NSIS 钩子先卸包以释放 DLL，
//! 启动时若意图为开且未注册/版本不符，后台补注册——只在无需 UAC 时做（不在启动时弹授权框），
//! 否则设置页显示「重新注册」。意图为关时启动不做任何事（不起 PowerShell）。
//! 与经典 HKCU 菜单（shell_integration.rs）相互独立，可同时开启。

use serde::Serialize;

pub const PACKAGE_NAME: &str = "TagLauncher.ShellMenu";
pub const SETTING_KEY: &str = "shell.win11_menu";
/// `tag-launcher.exe --win11-menu add|remove`
pub const CLI_ARG: &str = "--win11-menu";
/// Windows 11 起支持未签名包
pub const MIN_BUILD: u32 = 22000;
/// 程序目录下的资源子目录（tauri.conf.json bundle.resources）
pub const RESOURCE_DIR: &str = "win11-menu";
pub const MSIX_FILE: &str = "TagLauncher.ShellMenu.msix";
pub const DLL_FILE: &str = "tl_menu.dll";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Win11MenuStatus {
    /// 本机可用（Windows 11 且安装包里带了菜单组件）
    pub supported: bool,
    /// 不可用的原因（supported=false 时）
    pub reason: Option<String>,
    /// 用户意图（设置）
    pub enabled: bool,
    /// 稀疏包实际已注册
    pub registered: bool,
    pub registered_version: Option<String>,
    /// 本程序附带的包版本
    pub bundled_version: String,
    /// 当前进程权限：elevated（直接注册）/ uac（注册时弹一次 UAC）/ standard（标准用户，通常不能注册）
    pub privilege: Privilege,
}

/// 当前进程的权限形态，决定注册走哪条路
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Privilege {
    /// 已提权，或 UAC 关闭的管理员
    Elevated,
    /// UAC 受限令牌的管理员：可经 runas 提权（弹一次 UAC）
    Uac,
    /// 标准用户账户
    Standard,
}

/// TOKEN_ELEVATION_TYPE（1 默认 / 2 完整 / 3 受限）+ 是否管理员 → 权限形态。
/// 默认型令牌出现在 UAC 关闭或标准用户时，靠是否管理员区分。
pub fn classify_privilege(elevation_type: i32, is_admin: bool) -> Privilege {
    match elevation_type {
        2 => Privilege::Elevated,
        3 => Privilege::Uac,
        _ if is_admin => Privilege::Elevated,
        _ => Privilege::Standard,
    }
}

pub const STANDARD_USER_HINT: &str =
    "当前是标准用户账户：Windows 只允许管理员安装含代码的未签名组件，请用管理员账户开启";

/// 注册失败的说明：标准用户撞上「未签名包须管理员安装」时补一句原因
pub fn register_error(privilege: Privilege, err: &str) -> String {
    let unsigned_admin_only = err.contains("0x80073D19")
        || err.contains("Executable activations")
        || err.contains("not a valid unsigned package");
    if privilege == Privilege::Standard && unsigned_admin_only {
        format!("注册 Win11 右键菜单失败：{STANDARD_USER_HINT}（{err}）")
    } else {
        format!("注册 Win11 右键菜单失败：{err}")
    }
}

/// 启动补注册只在不需要弹 UAC 时做
pub fn can_register_silently(privilege: Privilege) -> bool {
    privilege != Privilege::Uac
}

/// 应用版本 → 包版本四段式（预发布后缀去掉，缺的段补 0）
pub fn package_version(app_version: &str) -> String {
    let core = app_version.split(['-', '+']).next().unwrap_or("0");
    let mut parts: Vec<u32> = core
        .split('.')
        .map(|p| p.parse::<u32>().unwrap_or(0).min(65535))
        .take(4)
        .collect();
    while parts.len() < 4 {
        parts.push(0);
    }
    parts
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".")
}

pub fn bundled_version() -> String {
    package_version(env!("CARGO_PKG_VERSION"))
}

/// PowerShell 单引号字符串字面量
pub fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

pub fn unsupported_reason(build: Option<u32>, bundled: bool) -> Option<String> {
    match build {
        None => Some("仅支持 Windows 11".into()),
        Some(b) if b < MIN_BUILD => Some(format!("需要 Windows 11（当前 build {b}）")),
        _ if !bundled => Some("此构建未附带 Win11 菜单组件".into()),
        _ => None,
    }
}

/// 启动补注册的判定：意图开、可用、且未注册或版本不同
pub fn needs_register(
    intent: bool,
    supported: bool,
    registered_version: Option<&str>,
    bundled: &str,
) -> bool {
    intent && supported && registered_version != Some(bundled)
}

pub fn register_script(msix: &str, external_location: &str) -> String {
    format!(
        "$ErrorActionPreference='Stop'; Get-AppxPackage -Name {PACKAGE_NAME} | Remove-AppxPackage; \
         Add-AppxPackage -Path {} -ExternalLocation {} -AllowUnsigned",
        ps_quote(msix),
        ps_quote(external_location)
    )
}

pub fn remove_script() -> String {
    format!(
        "$ErrorActionPreference='Stop'; Get-AppxPackage -Name {PACKAGE_NAME} | Remove-AppxPackage"
    )
}

pub fn query_script() -> String {
    format!("$p = Get-AppxPackage -Name {PACKAGE_NAME}; if ($p) {{ [string]$p.Version }}")
}

/// PowerShell 错误输出只留有用的一行（含 HRESULT 的优先），限长
pub fn summarize_ps_error(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('+') && !l.starts_with("At line"))
        .collect();
    let pick = lines
        .iter()
        .find(|l| l.contains("HRESULT"))
        .or_else(|| lines.first())
        .copied()
        .unwrap_or("PowerShell 执行失败");
    pick.chars().take(300).collect()
}

#[cfg(windows)]
pub mod platform {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    pub fn os_build() -> Option<u32> {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
            .ok()?
            .get_value::<String, _>("CurrentBuildNumber")
            .ok()?
            .trim()
            .parse()
            .ok()
    }

    /// 稀疏包的外部位置 = 程序目录；包内文件在 <程序目录>\win11-menu\
    pub fn program_dir() -> Result<PathBuf, String> {
        std::env::current_exe()
            .map_err(|e| format!("取不到程序路径：{e}"))?
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| "取不到程序目录".to_string())
    }

    /// 安装包是否带了真实组件（CI/开发构建可能只有 0 字节占位）
    pub fn bundled() -> bool {
        let Ok(dir) = program_dir() else { return false };
        let res = dir.join(RESOURCE_DIR);
        [MSIX_FILE, DLL_FILE].iter().all(|f| {
            std::fs::metadata(res.join(f))
                .map(|m| m.len() > 0)
                .unwrap_or(false)
        })
    }

    fn run_ps(script: &str) -> Result<String, String> {
        let full = format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; {script}"
        );
        let out = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                full.as_str(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("无法启动 PowerShell：{e}"))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(summarize_ps_error(&String::from_utf8_lossy(&out.stderr)))
        }
    }

    pub fn registered_version() -> Result<Option<String>, String> {
        let v = run_ps(&query_script())?;
        Ok((!v.is_empty()).then_some(v))
    }

    /// 当前进程令牌的权限形态
    pub fn privilege() -> Privilege {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevationType, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        use windows_sys::Win32::UI::Shell::IsUserAnAdmin;
        let mut elevation_type: i32 = 1;
        // SAFETY: 只读查询当前进程令牌；句柄用完即关
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0 {
                let mut len = 0u32;
                if GetTokenInformation(
                    token,
                    TokenElevationType,
                    (&mut elevation_type as *mut i32).cast(),
                    std::mem::size_of::<i32>() as u32,
                    &mut len,
                ) == 0
                {
                    elevation_type = 1;
                }
                CloseHandle(token);
            }
            classify_privilege(elevation_type, IsUserAnAdmin() != 0)
        }
    }

    /// 以管理员身份运行一段 PowerShell（弹 UAC），等它结束。错误经临时文件带回。
    fn run_ps_elevated(script: &str) -> Result<(), String> {
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, ERROR_CANCELLED, WAIT_OBJECT_0,
        };
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
        use windows_sys::Win32::UI::Shell::{
            ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let base =
            std::env::temp_dir().join(format!("tl-win11-menu-{}-{stamp}", std::process::id()));
        let ps1 = base.with_extension("ps1");
        let err_file = base.with_extension("err");
        let body = format!(
            "$ProgressPreference='SilentlyContinue'\r\ntry {{ {script}; exit 0 }} catch {{ [IO.File]::WriteAllText({}, ($_ | Out-String), [Text.Encoding]::UTF8); exit 1 }}\r\n",
            ps_quote(&err_file.to_string_lossy())
        );
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(body.as_bytes());
        std::fs::write(&ps1, bytes).map_err(|e| format!("写临时脚本失败：{e}"))?;
        let cleanup = || {
            let _ = std::fs::remove_file(&ps1);
            let _ = std::fs::remove_file(&err_file);
        };
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let verb = wide("runas");
        let file = wide("powershell.exe");
        let params = wide(&format!(
            "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"",
            ps1.display()
        ));
        // SAFETY: 结构体按 Win32 约定零初始化后填字段；宽字符串在调用期间存活
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        if unsafe { ShellExecuteExW(&mut info) } == 0 {
            let code = unsafe { GetLastError() };
            cleanup();
            return Err(if code == ERROR_CANCELLED {
                "已取消管理员授权".to_string()
            } else {
                format!("无法以管理员身份启动 PowerShell（错误 {code}）")
            });
        }
        if info.hProcess.is_null() {
            cleanup();
            return Err("无法以管理员身份启动 PowerShell".to_string());
        }
        let mut exit_code = 1u32;
        // SAFETY: hProcess 由 SEE_MASK_NOCLOSEPROCESS 交给我们，等待后关闭
        let waited = unsafe { WaitForSingleObject(info.hProcess, 120_000) };
        unsafe {
            if waited == WAIT_OBJECT_0 {
                GetExitCodeProcess(info.hProcess, &mut exit_code);
            }
            CloseHandle(info.hProcess);
        }
        let detail = std::fs::read_to_string(&err_file).ok();
        cleanup();
        if waited != WAIT_OBJECT_0 {
            return Err("管理员 PowerShell 超过 120 秒未结束".to_string());
        }
        if exit_code == 0 {
            Ok(())
        } else {
            Err(summarize_ps_error(detail.as_deref().unwrap_or("")))
        }
    }

    pub fn register() -> Result<(), String> {
        let dir = program_dir()?;
        let msix = dir.join(RESOURCE_DIR).join(MSIX_FILE);
        let script = register_script(&msix.to_string_lossy(), &dir.to_string_lossy());
        let privilege = privilege();
        let result = match privilege {
            Privilege::Uac => run_ps_elevated(&script),
            _ => run_ps(&script).map(|_| ()),
        };
        result.map_err(|e| register_error(privilege, &e))
    }

    /// 移除自己的注册不需要提权；万一失败且可提权，再经 UAC 重试一次
    pub fn unregister() -> Result<(), String> {
        let result = run_ps(&remove_script()).map(|_| ());
        let result = match result {
            Err(_) if privilege() == Privilege::Uac => run_ps_elevated(&remove_script()),
            other => other,
        };
        result.map_err(|e| format!("移除 Win11 右键菜单失败：{e}"))
    }
}

#[cfg(not(windows))]
pub mod platform {
    use super::Privilege;
    pub fn privilege() -> Privilege {
        Privilege::Standard
    }
    pub fn os_build() -> Option<u32> {
        None
    }
    pub fn bundled() -> bool {
        false
    }
    pub fn registered_version() -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn register() -> Result<(), String> {
        Err("Win11 右键菜单仅支持 Windows 11".into())
    }
    pub fn unregister() -> Result<(), String> {
        Ok(())
    }
}

fn availability() -> Option<String> {
    unsupported_reason(platform::os_build(), platform::bundled())
}

pub fn status(intent: bool) -> Result<Win11MenuStatus, String> {
    let reason = availability();
    let registered_version = if reason.is_none() {
        platform::registered_version()?
    } else {
        None
    };
    Ok(Win11MenuStatus {
        supported: reason.is_none(),
        reason,
        enabled: intent,
        registered: registered_version.is_some(),
        registered_version,
        bundled_version: bundled_version(),
        privilege: platform::privilege(),
    })
}

/// 命令行：`--win11-menu add|remove`（部署脚本 / 便携版删目录前清理）。不是本参数时返回 None。
pub fn handle_cli(args: &[String]) -> Option<i32> {
    let pos = args.iter().position(|a| a == CLI_ARG)?;
    let result = match args.get(pos + 1).map(String::as_str) {
        Some("add") => match availability() {
            Some(reason) => Err(reason),
            None => platform::register().map(|_| "已添加 Win11 一级右键菜单"),
        },
        Some("remove") => platform::unregister().map(|_| "已移除 Win11 一级右键菜单"),
        other => {
            eprintln!("用法：tag-launcher.exe {CLI_ARG} add|remove（收到 {other:?}）");
            return Some(2);
        }
    };
    match result {
        Ok(msg) => {
            println!("{msg}");
            Some(0)
        }
        Err(e) => {
            eprintln!("{e}");
            Some(1)
        }
    }
}

fn read_intent(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    let db = app.state::<crate::db::Database>();
    let conn = db.get_conn();
    let value = crate::services::settings_service::get_setting(&conn, SETTING_KEY);
    value.as_deref() == Some("1")
}

/// 启动时后台补注册（升级安装前钩子会卸包；便携版换目录后需要重新指向）。意图为关时立即返回。
pub fn reconcile_on_startup(app: tauri::AppHandle) {
    if !read_intent(&app) {
        return;
    }
    std::thread::spawn(move || {
        let Ok(st) = status(true) else { return };
        if !can_register_silently(st.privilege) {
            if st.registered_version.as_deref() != Some(st.bundled_version.as_str()) {
                log::info!("Win11 右键菜单需要重新注册（需管理员授权，等待用户在设置页操作）");
            }
            return;
        }
        if needs_register(
            true,
            st.supported,
            st.registered_version.as_deref(),
            &st.bundled_version,
        ) {
            match platform::register() {
                Ok(()) => log::info!("Win11 右键菜单已按设置重新注册（{}）", st.bundled_version),
                Err(e) => log::warn!("{e}"),
            }
        }
    });
}

// ───────────────────────────── 命令 ─────────────────────────────

#[tauri::command]
pub async fn get_win11_menu(app: tauri::AppHandle) -> Result<Win11MenuStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(read_intent(&app)))
        .await
        .map_err(|e| e.to_string())?
}

/// 开启（也用于「重新注册」修复）/ 关闭并移除。开启失败不保存意图。
#[tauri::command]
pub async fn set_win11_menu(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<Win11MenuStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        crate::db::ensure_writes_allowed()?;
        if enabled {
            if let Some(reason) = availability() {
                return Err(reason);
            }
            platform::register()?;
        } else {
            platform::unregister()?;
        }
        {
            let db = app.state::<crate::db::Database>();
            let conn = db.get_conn();
            crate::services::settings_service::set_setting(
                &conn,
                SETTING_KEY,
                if enabled { "1" } else { "0" },
            )?;
        }
        status(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_version_pads_and_strips_prerelease() {
        assert_eq!(package_version("0.9.3"), "0.9.3.0");
        assert_eq!(package_version("1.2.3-beta.4"), "1.2.3.0");
        assert_eq!(package_version("2"), "2.0.0.0");
        assert_eq!(package_version("1.2.3.4.5"), "1.2.3.4");
    }

    #[test]
    fn ps_quote_doubles_single_quotes() {
        assert_eq!(ps_quote(r"D:\It's\x"), r"'D:\It''s\x'");
        let s = register_script(r"C:\a'b\p.msix", r"C:\a'b");
        assert!(s.contains(r"-Path 'C:\a''b\p.msix' -ExternalLocation 'C:\a''b' -AllowUnsigned"));
        assert!(s.contains("Get-AppxPackage -Name TagLauncher.ShellMenu | Remove-AppxPackage"));
    }

    #[test]
    fn unsupported_reason_requires_win11_and_bundle() {
        assert!(unsupported_reason(None, true).is_some());
        assert!(unsupported_reason(Some(20348), true)
            .unwrap()
            .contains("20348"));
        assert!(unsupported_reason(Some(22000), false)
            .unwrap()
            .contains("未附带"));
        assert_eq!(unsupported_reason(Some(26100), true), None);
    }

    #[test]
    fn needs_register_only_when_intent_on_and_version_differs() {
        assert!(needs_register(true, true, None, "1.0.0.0"));
        assert!(needs_register(true, true, Some("0.9.0.0"), "1.0.0.0"));
        assert!(!needs_register(true, true, Some("1.0.0.0"), "1.0.0.0"));
        assert!(!needs_register(false, true, None, "1.0.0.0"));
        assert!(!needs_register(true, false, None, "1.0.0.0"));
    }

    #[test]
    fn privilege_from_token_type_and_admin() {
        assert_eq!(classify_privilege(2, true), Privilege::Elevated);
        assert_eq!(classify_privilege(3, false), Privilege::Uac);
        assert_eq!(classify_privilege(1, true), Privilege::Elevated); // UAC 关闭的管理员
        assert_eq!(classify_privilege(1, false), Privilege::Standard);
        assert!(can_register_silently(Privilege::Elevated));
        assert!(can_register_silently(Privilege::Standard));
        assert!(!can_register_silently(Privilege::Uac));
    }

    #[test]
    fn standard_user_error_explains_admin_requirement() {
        // CI 探针实测的报错原文（标准用户、系统中无人注册）
        let e = "Deployment failed with HRESULT: 0x80073D19, An error occurred because a user was logged off.";
        assert!(register_error(Privilege::Standard, e).contains("标准用户"));
        assert!(!register_error(Privilege::Uac, e).contains("标准用户"));
        assert!(!register_error(Privilege::Standard, "0x80073CF3 conflict").contains("标准用户"));
        assert_eq!(serde_json::to_string(&Privilege::Uac).unwrap(), "\"uac\"");
    }

    #[test]
    fn summarize_prefers_hresult_line() {
        let err = "Add-AppxPackage : Deployment failed with HRESULT: 0x80073D2B, bad\nAt line:1 char:1\n+ Add-AppxPackage\n";
        assert_eq!(
            summarize_ps_error(err),
            "Add-AppxPackage : Deployment failed with HRESULT: 0x80073D2B, bad"
        );
        assert_eq!(summarize_ps_error(""), "PowerShell 执行失败");
    }
}

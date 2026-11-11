//! Win11 一级右键菜单（实验，默认关闭）：未签名稀疏包 + IExplorerCommand 进程外 COM
//! （源码 shell-ext/win11-menu，构建 scripts/prepare-win11-menu.mjs）。
//!
//! CI 实测（Win11 26100/26200，开发者模式强制关、标准用户也可）：
//! - `Add-AppxPackage -Path <msix> -ExternalLocation <程序目录> -AllowUnsigned`：Publisher 末尾带
//!   Unsigned OID，不需要证书、不需要导入任何根证书、不改系统全局注册表；Win10 / Server 2022
//!   （20348）拒绝（0x80073D2B），所以要求 build ≥ 22000。
//! - 菜单项由 dllhost 代理进程里的 DLL 提供，dllhost 带包标识：子进程须经桌面 explorer 启动
//!   （DLL 内实现），否则 TagLauncher 会继承包标识；清单同时关闭 AppData/注册表写虚拟化兜底。
//! - `Remove-AppxPackage` 后菜单即时消失，PackagedCom 键与 DLL 文件锁一并释放，无 HKCU 残留。
//!
//! 意图存设置 `shell.win11_menu`（"1" 开）：安装/升级前 NSIS 钩子先卸包以释放 DLL，
//! 启动时若意图为开且未注册/版本不符，后台补注册。意图为关时启动不做任何事（不起 PowerShell）。
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

    pub fn register() -> Result<(), String> {
        let dir = program_dir()?;
        let msix = dir.join(RESOURCE_DIR).join(MSIX_FILE);
        run_ps(&register_script(
            &msix.to_string_lossy(),
            &dir.to_string_lossy(),
        ))
        .map(|_| ())
        .map_err(|e| format!("注册 Win11 右键菜单失败：{e}"))
    }

    pub fn unregister() -> Result<(), String> {
        run_ps(&remove_script())
            .map(|_| ())
            .map_err(|e| format!("移除 Win11 右键菜单失败：{e}"))
    }
}

#[cfg(not(windows))]
pub mod platform {
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
    fn summarize_prefers_hresult_line() {
        let err = "Add-AppxPackage : Deployment failed with HRESULT: 0x80073D2B, bad\nAt line:1 char:1\n+ Add-AppxPackage\n";
        assert_eq!(
            summarize_ps_error(err),
            "Add-AppxPackage : Deployment failed with HRESULT: 0x80073D2B, bad"
        );
        assert_eq!(summarize_ps_error(""), "PowerShell 执行失败");
    }
}

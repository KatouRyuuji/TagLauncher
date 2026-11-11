//! 资源管理器右键菜单与「发送到」（全局极速阶段③，设计见 plan §4）。
//!
//! - 经典 HKCU 注册表动词，不需要管理员：文件（`*`）、文件夹（`Directory`）、文件夹背景
//!   （`Directory\Background`，`%V` = 当前目录）各一个「用 TagLauncher 收纳…」。Win11 上在
//!   「显示更多选项」里；一级菜单需要签名的稀疏包，不做。
//! - 「发送到」：`%APPDATA%\Microsoft\Windows\SendTo` 下一个指向 GUI exe 的快捷方式，多选时
//!   一次启动、全部路径作参数。
//! - 默认关闭，设置里手动开启；关闭时把注册项和快捷方式全部删掉。状态不另存设置，一律以
//!   注册表/文件的实际情况为准（开启失败回滚）。卸载钩子（windows/hooks.nsh）无条件清理同样的键。
//! - 命令行 `"<exe>" --collect "%1"`：参数只当路径数据（见 collect.rs），exe 与占位符都加引号。

use serde::Serialize;

/// 三处动词共用的子键名
pub const VERB_KEY: &str = "TagLauncher.Collect";
/// 菜单文字
pub const MENU_TEXT: &str = "用 TagLauncher 收纳…";
/// 「发送到」快捷方式文件名（卸载钩子按 *TagLauncher*.lnk 清理，名字里须含 TagLauncher）
pub const SENDTO_FILE: &str = "用 TagLauncher 收纳.lnk";
/// 收纳参数：其后的参数全部是路径
pub const COLLECT_ARG: &str = "--collect";
/// 便携版清理入口：`tag-launcher.exe --shell-integration remove`
pub const CLI_ARG: &str = "--shell-integration";

/// 注册位置：HKCU\Software\Classes\<class>\shell\TagLauncher.Collect
pub const VERB_CLASSES: [(&str, &str); 3] = [
    ("*", "%1"),
    ("Directory", "%1"),
    ("Directory\\Background", "%V"),
];

pub fn verb_key_path(class: &str) -> String {
    format!("Software\\Classes\\{class}\\shell\\{VERB_KEY}")
}

pub fn command_line(exe: &str, placeholder: &str) -> String {
    format!("\"{exe}\" {COLLECT_ARG} \"{placeholder}\"")
}

/// 从已注册的命令行取出 exe 路径（第一个引号对里的内容）
pub fn registered_exe(command: &str) -> Option<String> {
    let rest = command.trim_start().strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Windows 路径比较：不区分大小写，统一分隔符
pub fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    /// 当前平台是否支持（仅 Windows）
    pub supported: bool,
    /// 三处动词与「发送到」都在
    pub enabled: bool,
    /// 只有一部分在（上次清理中断、手动删过等）：设置页提示「修复」或「清理」
    pub partial: bool,
    /// 注册表里命令指向的 exe（取第一处找到的）
    pub registered_exe: Option<String>,
    pub current_exe: String,
    /// 注册的 exe 就是当前程序（便携版挪了位置时为 false，需「修复为当前位置」）
    pub exe_matches: bool,
    pub send_to: bool,
    /// 每处动词是否存在（与 VERB_CLASSES 同序），便于诊断
    pub verbs: Vec<bool>,
}

/// 由各部分的实际存在情况合成状态（纯函数，便于单测）
pub fn compose_status(
    current_exe: &str,
    commands: &[Option<String>],
    send_to: bool,
) -> ShellIntegrationStatus {
    let verbs: Vec<bool> = commands.iter().map(|c| c.is_some()).collect();
    let present = verbs.iter().filter(|v| **v).count() + usize::from(send_to);
    let total = verbs.len() + 1;
    let registered = commands.iter().flatten().find_map(|c| registered_exe(c));
    let exe_matches = commands
        .iter()
        .flatten()
        .all(|c| registered_exe(c).is_some_and(|e| same_path(&e, current_exe)))
        && present > 0;
    ShellIntegrationStatus {
        supported: cfg!(windows),
        enabled: present == total,
        partial: present > 0 && present < total,
        registered_exe: registered,
        current_exe: current_exe.to_string(),
        exe_matches,
        send_to,
        verbs,
    }
}

fn current_exe() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("取不到程序路径：{e}"))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::io::ErrorKind;
    use std::path::PathBuf;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    /// 「发送到」目录：按 APPDATA 环境变量（E2E 沙箱会重定向它）
    pub fn send_to_path() -> Option<PathBuf> {
        let appdata = std::env::var_os("APPDATA")?;
        Some(
            PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("SendTo")
                .join(SENDTO_FILE),
        )
    }

    pub fn read_commands() -> Vec<Option<String>> {
        VERB_CLASSES
            .iter()
            .map(|(class, _)| {
                hkcu()
                    .open_subkey(format!("{}\\command", verb_key_path(class)))
                    .ok()
                    .and_then(|k| k.get_value::<String, _>("").ok())
            })
            .collect()
    }

    pub fn send_to_exists() -> bool {
        send_to_path().is_some_and(|p| p.is_file())
    }

    pub fn write_all(exe: &str) -> Result<(), String> {
        for (class, placeholder) in VERB_CLASSES {
            let path = verb_key_path(class);
            let (key, _) = hkcu()
                .create_subkey(&path)
                .map_err(|e| format!("写注册表 {path} 失败：{e}"))?;
            key.set_value("", &MENU_TEXT)
                .and_then(|_| key.set_value("Icon", &format!("\"{exe}\",0")))
                .and_then(|_| key.set_value("MultiSelectModel", &"Player"))
                .map_err(|e| format!("写注册表 {path} 失败：{e}"))?;
            let (cmd, _) = key
                .create_subkey("command")
                .map_err(|e| format!("写注册表 {path}\\command 失败：{e}"))?;
            cmd.set_value("", &command_line(exe, placeholder))
                .map_err(|e| format!("写注册表 {path}\\command 失败：{e}"))?;
        }
        let link = send_to_path().ok_or("取不到「发送到」目录（APPDATA 未设置）")?;
        if let Some(dir) = link.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("创建「发送到」目录失败：{e}"))?;
        }
        write_shortcut(&link, exe).map_err(|e| format!("写「发送到」快捷方式失败：{e}"))?;
        notify_shell();
        Ok(())
    }

    /// 用系统 IShellLinkW 写快捷方式（mslnk 手拼的 .lnk 在 CI 上被 WScript 读成空目标）
    fn write_shortcut(link: &std::path::Path, exe: &str) -> Result<(), String> {
        use windows::core::{Interface, HSTRING};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
        // SAFETY: COM 调用都在本线程内完成；只有本次初始化成功（含 S_FALSE）才配对反初始化，
        // 线程已按其他模式初始化（RPC_E_CHANGED_MODE）时沿用现有套间。
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let result = (|| -> windows::core::Result<()> {
                let sl: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                sl.SetPath(&HSTRING::from(exe))?;
                sl.SetArguments(&HSTRING::from(COLLECT_ARG))?;
                sl.SetDescription(&HSTRING::from(MENU_TEXT))?;
                sl.SetIconLocation(&HSTRING::from(exe), 0)?;
                if let Some(dir) = std::path::Path::new(exe).parent() {
                    sl.SetWorkingDirectory(&HSTRING::from(dir))?;
                }
                let file: IPersistFile = sl.cast()?;
                file.Save(&HSTRING::from(link), true)
            })();
            if init.is_ok() {
                CoUninitialize();
            }
            result.map_err(|e| e.to_string())
        }
    }

    /// 删除全部注册项与快捷方式；不存在的视为已删除。逐项尝试，汇总失败。
    pub fn remove_all() -> Result<(), String> {
        let mut errors = Vec::new();
        for (class, _) in VERB_CLASSES {
            let path = verb_key_path(class);
            match hkcu().delete_subkey_all(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => errors.push(format!("删除注册表 {path} 失败：{e}")),
            }
        }
        if let Some(link) = send_to_path() {
            match std::fs::remove_file(&link) {
                Ok(()) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => errors.push(format!("删除「发送到」快捷方式失败：{e}")),
            }
        }
        notify_shell();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("；"))
        }
    }

    /// 让资源管理器重新读取关联（经典动词本就即时生效，这里只是保险）
    fn notify_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn read_commands() -> Vec<Option<String>> {
        super::VERB_CLASSES.iter().map(|_| None).collect()
    }
    pub fn send_to_exists() -> bool {
        false
    }
    pub fn write_all(_exe: &str) -> Result<(), String> {
        Err("资源管理器右键菜单仅支持 Windows".into())
    }
    pub fn remove_all() -> Result<(), String> {
        Ok(())
    }
}

pub fn status() -> Result<ShellIntegrationStatus, String> {
    let exe = current_exe()?;
    Ok(compose_status(
        &exe,
        &platform::read_commands(),
        platform::send_to_exists(),
    ))
}

/// 开启（或修复为当前位置）：先清掉旧的再写；任何一步失败都整体回滚，返回错误。
pub fn enable() -> Result<ShellIntegrationStatus, String> {
    let exe = current_exe()?;
    let _ = platform::remove_all();
    if let Err(e) = platform::write_all(&exe) {
        let rollback = platform::remove_all();
        return Err(match rollback {
            Ok(()) => format!("{e}（已回滚）"),
            Err(r) => format!("{e}；回滚也失败：{r}"),
        });
    }
    status()
}

pub fn disable() -> Result<ShellIntegrationStatus, String> {
    platform::remove_all()?;
    status()
}

/// 便携版命令行清理：`--shell-integration remove`。返回进程退出码；不是本参数时返回 None。
pub fn handle_cli(args: &[String]) -> Option<i32> {
    let pos = args.iter().position(|a| a == CLI_ARG)?;
    match args.get(pos + 1).map(String::as_str) {
        Some("remove") => match platform::remove_all() {
            Ok(()) => {
                println!("已清理资源管理器右键菜单与「发送到」");
                Some(0)
            }
            Err(e) => {
                eprintln!("{e}");
                Some(1)
            }
        },
        other => {
            eprintln!("用法：tag-launcher.exe {CLI_ARG} remove（收到 {other:?}）");
            Some(2)
        }
    }
}

// ───────────────────────────── 命令 ─────────────────────────────

#[tauri::command]
pub fn get_shell_integration() -> Result<ShellIntegrationStatus, String> {
    status()
}

/// 开关右键菜单。enabled=true 时也用于「修复为当前位置」。
#[tauri::command]
pub fn set_shell_integration(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    if enabled {
        enable()
    } else {
        disable()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_quotes_exe_and_placeholder() {
        assert_eq!(
            command_line(r"D:\Apps\Tag Launcher\tag-launcher.exe", "%1"),
            r#""D:\Apps\Tag Launcher\tag-launcher.exe" --collect "%1""#
        );
        assert_eq!(
            verb_key_path("Directory\\Background"),
            r"Software\Classes\Directory\Background\shell\TagLauncher.Collect"
        );
        let placeholders: Vec<_> = VERB_CLASSES.iter().map(|(_, p)| *p).collect();
        assert_eq!(placeholders, ["%1", "%1", "%V"]);
    }

    #[test]
    fn registered_exe_reads_first_quoted_path() {
        let cmd = command_line(r"C:\x y\a.exe", "%V");
        assert_eq!(registered_exe(&cmd).as_deref(), Some(r"C:\x y\a.exe"));
        assert_eq!(registered_exe("a.exe --collect"), None);
        assert!(same_path(r"C:\X Y\A.EXE", "c:/x y/a.exe"));
    }

    #[test]
    fn status_distinguishes_off_partial_on_and_moved_exe() {
        let exe = r"D:\TL\tag-launcher.exe";
        let cmd = |e: &str| Some(command_line(e, "%1"));
        let off = compose_status(exe, &[None, None, None], false);
        assert!(!off.enabled && !off.partial && !off.exe_matches && off.registered_exe.is_none());
        let on = compose_status(exe, &[cmd(exe), cmd(exe), cmd(exe)], true);
        assert!(on.enabled && !on.partial && on.exe_matches);
        let partial = compose_status(exe, &[cmd(exe), None, None], false);
        assert!(!partial.enabled && partial.partial);
        let moved = compose_status(
            exe,
            &[
                cmd(r"E:\old\tag-launcher.exe"),
                cmd(r"E:\old\tag-launcher.exe"),
                cmd(r"E:\old\tag-launcher.exe"),
            ],
            true,
        );
        assert!(moved.enabled && !moved.exe_matches);
        assert_eq!(
            moved.registered_exe.as_deref(),
            Some(r"E:\old\tag-launcher.exe")
        );
    }

    #[test]
    fn cli_only_handles_its_own_argument() {
        assert_eq!(handle_cli(&["--background".into()]), None);
        assert_eq!(handle_cli(&[CLI_ARG.into(), "bogus".into()]), Some(2));
    }
}

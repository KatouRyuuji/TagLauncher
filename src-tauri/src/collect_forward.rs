//! 右键「收纳」的快速转发。
//!
//! 资源管理器多选 N 项时按 Player 模型每项启动一个进程。走单实例插件的话，每个进程都要先建
//! Tauri 运行时（事件循环、配置、插件表）才在插件 setup 里转发参数，N 个进程同时做这件事，
//! 50 项时最后一项要 8 秒才到（D-SHELL-04 实测）。这里在建运行时之前直接找到首个实例的
//! 单实例消息窗口，按插件相同的格式发 WM_COPYDATA 后退出；首个实例由插件的窗口过程接收，
//! 走同一个 `handle_second_instance` 回调。找不到窗口（首个实例还没起来、或没有在运行）
//! 时什么也不做，照常进入插件路径。
//!
//! 窗口类名 / 标题 / dwData / 数据格式与 tauri-plugin-single-instance 2.5（未开 semver 特性）一致，
//! 由单元测试锁定 identifier 与 tauri.conf.json 相同；插件升级时需核对。

/// tauri.conf.json 的 identifier（插件用它拼窗口类名）
pub const IDENTIFIER: &str = "com.taglauncher.app";
/// 插件的 WM_COPYDATA dwData 标记
pub const COPYDATA_TAG: usize = 1542;

/// 插件窗口类名与标题
pub fn window_names(identifier: &str) -> (String, String) {
    (format!("{identifier}-sic"), format!("{identifier}-siw"))
}

/// 插件的数据格式：`cwd|argv0|arg1|…\0`
pub fn payload(cwd: &str, argv: &[String]) -> String {
    format!("{cwd}|{}\0", argv.join("|"))
}

/// 只有 `--collect` 启动走快速转发（不含 argv0）：其余启动（再次双击、--background）
/// 频率低，按插件路径即可。
pub fn is_collect_launch(args: &[String]) -> bool {
    args.iter().any(|a| a == crate::collect::COLLECT_ARG)
}

/// 已有实例在运行时把本进程参数交给它并返回 true（调用方随即退出）。
pub fn try_forward(args: &[String]) -> bool {
    if !is_collect_launch(args) {
        return false;
    }
    #[cfg(windows)]
    {
        win::forward()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, FindWindowW, GetWindowThreadProcessId, SendMessageTimeoutW,
        SMTO_NORMAL, WM_COPYDATA,
    };

    /// windows-sys 的 COPYDATASTRUCT 在 DataExchange 特性里；布局固定，这里就地声明
    #[repr(C)]
    struct CopyData {
        dw_data: usize,
        cb_data: u32,
        lp_data: *const core::ffi::c_void,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn forward() -> bool {
        let (class, title) = super::window_names(super::IDENTIFIER);
        let (class, title) = (wide(&class), wide(&title));
        // SAFETY：参数均为本函数内有效的以 0 结尾宽字符串 / 栈上结构；SendMessageTimeout 同步返回后才释放
        unsafe {
            let hwnd = FindWindowW(class.as_ptr(), title.as_ptr());
            if hwnd.is_null() {
                return false;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != 0 {
                AllowSetForegroundWindow(pid);
            }
            let cwd = std::env::current_dir().unwrap_or_default();
            let argv: Vec<String> = std::env::args_os()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            let data = super::payload(&cwd.to_string_lossy(), &argv);
            let cds = CopyData {
                dw_data: super::COPYDATA_TAG,
                cb_data: data.len() as u32,
                lp_data: data.as_ptr().cast(),
            };
            let mut result = 0usize;
            let sent = SendMessageTimeoutW(
                hwnd,
                WM_COPYDATA,
                0,
                &cds as *const CopyData as isize,
                SMTO_NORMAL,
                10_000,
                &mut result,
            );
            // 首个实例的窗口过程收下即返回 1；发送失败时退回插件路径（它会再试一次）
            sent != 0 && result == 1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_matches_tauri_config() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
    }

    #[test]
    fn names_and_payload_follow_single_instance_plugin() {
        assert_eq!(
            window_names("com.taglauncher.app"),
            (
                "com.taglauncher.app-sic".to_string(),
                "com.taglauncher.app-siw".to_string()
            )
        );
        let argv = vec![
            "C:\\TL\\tag-launcher.exe".to_string(),
            "--collect".to_string(),
            "D:\\a b.txt".to_string(),
        ];
        assert_eq!(
            payload("C:\\Users\\me", &argv),
            "C:\\Users\\me|C:\\TL\\tag-launcher.exe|--collect|D:\\a b.txt\0"
        );
    }

    #[test]
    fn only_collect_launches_take_the_fast_path() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(is_collect_launch(&s(&["--collect", "D:\\a.txt"])));
        assert!(!is_collect_launch(&s(&[])));
        assert!(!is_collect_launch(&s(&["--background"])));
        assert!(!is_collect_launch(&s(&["--show"])));
    }
}

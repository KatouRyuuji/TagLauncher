use crate::services::item_service;
use rusqlite::Connection;
use std::path::Path;

/// 用系统关联程序打开文件/文件夹/URL：把路径作为**单个宽字符串**交给 Win32
/// ShellExecuteW（"open" 动词），**不经 cmd.exe**，从根上杜绝 `&`/`^`/`(` 等 shell
/// 元字符导致的命令注入（原实现 `cmd /C start "" <path>` 对不含空格的路径不加引号，
/// 会把这些字符当命令分隔符解释）。ShellExecuteW 不做任何 shell 解析。
#[cfg(target_os = "windows")]
fn shell_open(path: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

    // ShellExecuteW 约定：返回值 > 32 表示成功，否则即为错误码（如文件不存在）。
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err(format!("无法打开对象（ShellExecute 错误码 {}）", result as isize))
    }
}

/// 启动项目
pub fn launch_item(conn: &Connection, id: i64) -> Result<(), String> {
    // 路径可能已因重命名/移动失效：先按文件ID重定位到当前真实路径（并持久化）。
    let path = item_service::resolve_current_path(conn, id)?;

    // 经 ShellExecuteW 用关联程序打开。与旧的 cmd/start 不同，这里能拿到成功/失败信号：
    // 打开失败（如路径无效）直接返回 Err，从而不更新 last_used_at、不污染"最近使用"排序。
    #[cfg(target_os = "windows")]
    shell_open(&path)?;

    #[cfg(not(target_os = "windows"))]
    let _ = &path;

    conn.execute(
        "UPDATE items SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 在资源管理器中打开（按 id）：先按文件ID重定位到当前真实路径，再打开。
pub fn open_in_explorer_by_id(conn: &Connection, id: i64) -> Result<(), String> {
    let path = item_service::resolve_current_path(conn, id)?;
    open_in_explorer(&path)
}

/// 在资源管理器中打开
pub fn open_in_explorer(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let p = Path::new(path);
        let dir = if p.is_dir() {
            path.to_string()
        } else {
            p.parent()
                .map(|p| p.to_str().unwrap_or(path))
                .unwrap_or(path)
                .to_string()
        };
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

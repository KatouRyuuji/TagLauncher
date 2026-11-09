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
    // 工作目录 = 目标文件所在目录（与资源管理器双击一致）；传 null 会继承
    // TagLauncher 自身的 cwd，依赖相对路径读配置/资源的程序会找不到文件。
    let dir: Option<Vec<u16>> =
        launch_working_dir(path).map(|d| d.encode_utf16().chain(std::iter::once(0)).collect());

    // ShellExecuteW 约定：返回值 > 32 表示成功，否则即为错误码（如文件不存在）。
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            dir.as_ref().map_or(std::ptr::null(), |d| d.as_ptr()),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "无法打开对象（ShellExecute 错误码 {}）",
            result as isize
        ))
    }
}

/// 启动时的工作目录：文件取其父目录；目录、URL、无父目录时返回 None（沿用系统默认）。
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn launch_working_dir(path: &str) -> Option<String> {
    if path.contains("://") {
        return None;
    }
    let p = Path::new(path);
    if p.is_dir() {
        return None;
    }
    let parent = p.parent()?;
    if parent.as_os_str().is_empty() || !parent.is_dir() {
        return None;
    }
    parent.to_str().map(str::to_string)
}

/// 用关联程序打开任意路径（调用方负责先校验路径属于库内对象）。
pub fn open_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return shell_open(path);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("当前平台暂不支持打开文件".to_string())
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

    // 非 Windows 平台没有打开动作：直接报错，而不是什么都不做却更新 last_used_at
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &path;
        return Err("当前平台暂不支持启动对象".to_string());
    }

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

#[cfg(test)]
mod tests {
    use super::launch_working_dir;

    #[test]
    fn working_dir_is_parent_of_file() {
        let dir = std::env::temp_dir().join(format!("tl-launch-wd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("tool.exe");
        std::fs::write(&exe, b"x").unwrap();
        assert_eq!(
            launch_working_dir(exe.to_str().unwrap()).as_deref(),
            dir.to_str()
        );
        // 目录与 URL 不设工作目录
        assert_eq!(launch_working_dir(dir.to_str().unwrap()), None);
        assert_eq!(launch_working_dir("https://example.com/a"), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn working_dir_none_when_parent_missing() {
        assert_eq!(launch_working_dir("Z:/__tl_no_such_dir__/a.exe"), None);
        assert_eq!(launch_working_dir("a.exe"), None);
    }
}

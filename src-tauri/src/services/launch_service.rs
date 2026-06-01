use crate::services::item_service;
use rusqlite::Connection;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 启动项目
pub fn launch_item(conn: &Connection, id: i64) -> Result<(), String> {
    // 路径可能已因重命名/移动失效：先按文件ID重定位到当前真实路径（并持久化）。
    let path = item_service::resolve_current_path(conn, id)?;

    // 经 cmd /C start 间接启动：spawn 成功仅代表已成功"发起"启动
    //（start 在子进程内的失败无法被外层捕获），此处在发起成功后再更新 last_used_at，
    // 至少避免路径无效/重定位失败(resolve_current_path 返回 Err)时仍污染"最近使用"排序。
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
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

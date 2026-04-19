use rusqlite::Connection;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 启动项目
pub fn launch_item(conn: &Connection, id: i64) -> Result<(), String> {
    let path: String = conn
        .query_row("SELECT path FROM items WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE items SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
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

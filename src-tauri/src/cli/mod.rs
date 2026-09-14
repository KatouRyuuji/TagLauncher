//! CLI / MCP 共用核心：Tauri 无关的数据库定位与打开。
//!
//! tl.exe 与主程序同目录安装，因此 exe 旁 datapath.json 重定向与默认数据目录
//! （%LOCALAPPDATA%\TagLauncher\Save\）的解析结果与 GUI 完全一致。

use crate::db::Database;
use crate::services::path_service;
use std::path::PathBuf;

pub mod mcp;
pub mod tui;

/// 解析实库路径：exe 同级重定向优先，其次默认数据目录。
pub fn resolve_db_path() -> Result<PathBuf, String> {
    let root_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let save_dir = path_service::read_data_dir_redirect(&root_dir)
        .unwrap_or_else(|| path_service::default_save_dir(&root_dir));
    Ok(save_dir.join("taglauncher.db"))
}

/// 打开实库。数据库缺失/残骸时拒绝静默新建空库——CLI 面向「已初始化」的安装，
/// 找不到库多半意味着主程序从未运行或数据目录被重定向过，应显式报错。
pub fn open_db() -> Result<Database, String> {
    let path = resolve_db_path()?;
    if !path.exists() {
        return Err(format!(
            "数据库不存在：{}\n请先运行一次 TagLauncher 主程序完成初始化（或在主程序中设置数据目录）。",
            path.display()
        ));
    }
    Database::new(&path).map_err(|e| format!("打开数据库失败（{}）: {}", path.display(), e))
}

/// 库概览统计（CLI stats / MCP stats 工具共用）。
#[derive(serde::Serialize)]
pub struct CliStats {
    pub items: i64,
    pub favorites: i64,
    pub tags: i64,
    pub cabinets: i64,
    pub by_type: Vec<(String, i64)>,
}

pub fn collect_stats(conn: &rusqlite::Connection) -> Result<CliStats, String> {
    let scalar = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |r| r.get(0)).map_err(|e| e.to_string())
    };
    let mut stmt = conn
        .prepare("SELECT COALESCE(type, 'exe'), COUNT(*) FROM items GROUP BY type ORDER BY COUNT(*) DESC")
        .map_err(|e| e.to_string())?;
    let by_type = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(CliStats {
        items: scalar("SELECT COUNT(*) FROM items")?,
        favorites: scalar("SELECT COUNT(*) FROM items WHERE is_favorite = 1")?,
        tags: scalar("SELECT COUNT(*) FROM tags")?,
        cabinets: scalar("SELECT COUNT(*) FROM cabinets")?,
        by_type,
    })
}

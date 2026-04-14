use crate::models::{Item, ItemWithTags};
use crate::services::tag_service;
use crate::services::icon_service;
use rusqlite::{params, Connection};
use std::path::Path;
use tauri::AppHandle;

/// SELECT 查询中使用的列名常量
pub const ITEM_COLS: &str =
    "id, name, path, type, icon_path, created_at, last_used_at, is_favorite";

/// 默认排序：收藏优先 → 最近使用 → 名称
pub const ITEM_ORDER: &str = "is_favorite DESC, last_used_at DESC NULLS LAST, name";

/// 从数据库行映射为 Item
pub fn item_from_row(row: &rusqlite::Row) -> rusqlite::Result<Item> {
    let fav: i64 = row.get(7)?;
    Ok(Item {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        item_type: row.get(3)?,
        icon_path: row.get(4)?,
        created_at: row.get(5)?,
        last_used_at: row.get(6)?,
        is_favorite: fav != 0,
    })
}

/// 自动检测文件类型
pub fn detect_type(path: &str) -> &'static str {
    const IMAGE_EXTS: &[&str] = &[
        "png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic",
        "heif",
    ];

    let p = Path::new(path);
    if p.is_dir() {
        return "folder";
    }
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some(ext) if IMAGE_EXTS.contains(&ext) => "image",
        Some("exe") => "exe",
        Some("bat") | Some("cmd") => "bat",
        Some("ps1") => "ps1",
        _ => "exe",
    }
}

/// 从路径提取文件名
pub fn get_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

/// 添加项目
pub fn add_item(conn: &Connection, path: &str) -> Result<Item, String> {
    let name = get_name(path);
    let item_type = detect_type(path);

    conn.execute(
        "INSERT OR IGNORE INTO items (name, path, type) VALUES (?1, ?2, ?3)",
        params![name, path, item_type],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("SELECT {} FROM items WHERE path = ?1", ITEM_COLS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row([path], item_from_row)
        .map_err(|e| e.to_string())
}

/// 删除项目
pub fn remove_item(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 更新项目缩略图
pub fn update_item_icon(
    conn: &Connection,
    item_id: i64,
    icon_path: Option<String>,
) -> Result<(), String> {
    let normalized = icon_path.and_then(|p| {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let affected = conn
        .execute(
            "UPDATE items SET icon_path = ?1 WHERE id = ?2",
            params![normalized, item_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err(format!("Item {} not found", item_id));
    }
    Ok(())
}

/// 获取所有项目（含标签和自动图标）
pub fn get_items(app: &AppHandle, conn: &Connection) -> Result<Vec<ItemWithTags>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut items: Vec<Item> = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    icon_service::fill_auto_visual_paths(app, &mut items);
    tag_service::items_with_tags(conn, items)
}

/// 切换收藏状态
pub fn toggle_favorite(conn: &Connection, id: i64) -> Result<bool, String> {
    conn.execute(
        "UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    let new_val: i64 = conn
        .query_row("SELECT is_favorite FROM items WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(new_val != 0)
}

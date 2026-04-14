use crate::models::{Cabinet, Item, ItemWithTags};
use crate::services::icon_service;
use crate::services::item_service::item_from_row;
use crate::services::tag_service;
use rusqlite::{params, Connection};
use tauri::AppHandle;

/// 获取所有文件柜
pub fn get_cabinets(conn: &Connection) -> Result<Vec<Cabinet>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at FROM cabinets ORDER BY name")
        .map_err(|e| e.to_string())?;

    let cabinets = stmt
        .query_map([], |row| {
            Ok(Cabinet {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(cabinets)
}

/// 新建文件柜
pub fn add_cabinet(conn: &Connection, name: &str, color: &str) -> Result<Cabinet, String> {
    conn.execute(
        "INSERT INTO cabinets (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    let created_at: String = conn
        .query_row("SELECT created_at FROM cabinets WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(Cabinet {
        id,
        name: name.to_string(),
        color: color.to_string(),
        created_at,
    })
}

/// 更新文件柜
pub fn update_cabinet(conn: &Connection, id: i64, name: &str, color: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE cabinets SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除文件柜
pub fn remove_cabinet(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM cabinets WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 添加项目到文件柜
pub fn add_item_to_cabinet(conn: &Connection, cabinet_id: i64, item_id: i64) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO cabinet_items (cabinet_id, item_id) VALUES (?1, ?2)",
        params![cabinet_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从文件柜移除项目
pub fn remove_item_from_cabinet(
    conn: &Connection,
    cabinet_id: i64,
    item_id: i64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM cabinet_items WHERE cabinet_id = ?1 AND item_id = ?2",
        params![cabinet_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取文件柜内的所有项目
pub fn get_cabinet_items(
    app: &AppHandle,
    conn: &Connection,
    cabinet_id: i64,
) -> Result<Vec<ItemWithTags>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
             FROM items i
             INNER JOIN cabinet_items ci ON i.id = ci.item_id
             WHERE ci.cabinet_id = ?1
             ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        )
        .map_err(|e| e.to_string())?;

    let mut items: Vec<Item> = stmt
        .query_map([cabinet_id], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    icon_service::fill_auto_visual_paths(app, &mut items);
    tag_service::items_with_tags(conn, items)
}

use crate::models::{Item, ItemWithTags};
use crate::services::icon_service;
use crate::services::item_service::{item_from_row, ITEM_COLS, ITEM_ORDER};
use crate::services::tag_service;
use rusqlite::Connection;
use tauri::AppHandle;

/// 搜索项目（支持文本 + 标签组合查询）
pub fn search_items(
    app: &AppHandle,
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<ItemWithTags>, String> {
    let mut items: Vec<Item> = if query.is_empty() && tag_ids.is_empty() {
        query_all_items(conn)?
    } else if !query.is_empty() && tag_ids.is_empty() {
        query_items_by_text(conn, query)?
    } else if query.is_empty() && !tag_ids.is_empty() {
        query_items_by_tags(conn, tag_ids)?
    } else {
        query_items_by_text_and_tags(conn, query, tag_ids)?
    };

    icon_service::fill_auto_visual_paths(app, &mut items);
    tag_service::items_with_tags(conn, items)
}

fn query_all_items(conn: &Connection) -> Result<Vec<Item>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

fn query_items_by_text(conn: &Connection, query: &str) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let sql = format!(
        "SELECT {} FROM items WHERE name LIKE ?1 OR path LIKE ?1 ORDER BY {}",
        ITEM_COLS, ITEM_ORDER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([search_query], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

fn query_items_by_tags(conn: &Connection, tag_ids: &[i64]) -> Result<Vec<Item>, String> {
    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE it.tag_id IN ({})
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = tag_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

fn query_items_by_text_and_tags(
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE (i.name LIKE ?1 OR i.path LIKE ?1)
         AND it.tag_id IN ({})
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut params_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(search_query)];
    for id in tag_ids {
        params_values.push(Box::new(*id));
    }
    let params: Vec<&dyn rusqlite::ToSql> = params_values.iter().map(|p| p.as_ref()).collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

use crate::db::Database;
use crate::models::ItemWithTags;
use crate::services::{item_service, search_service};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn search_items(
    app: AppHandle,
    db: State<Database>,
    query: String,
    tag_ids: Vec<i64>,
) -> Result<Vec<ItemWithTags>, String> {
    // 锁内查询，锁外补图标，避免持锁期间执行图标提取等重 IO。
    let mut items = {
        let conn = db.get_conn();
        search_service::search_items(&conn, &query, &tag_ids)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
}

use crate::db::Database;
use crate::models::ItemWithTags;
use crate::services::search_service;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn search_items(
    app: AppHandle,
    db: State<Database>,
    query: String,
    tag_ids: Vec<i64>,
) -> Result<Vec<ItemWithTags>, String> {
    let conn = db.get_conn();
    search_service::search_items(&app, &conn, &query, &tag_ids)
}

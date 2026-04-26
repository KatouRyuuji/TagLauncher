use crate::db::Database;
use crate::models::{Item, ItemWithTags};
use crate::services::item_service;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn add_item(db: State<Database>, path: String) -> Result<Item, String> {
    let conn = db.get_conn();
    item_service::add_item(&conn, &path)
}

#[tauri::command]
pub fn add_items(db: State<Database>, paths: Vec<String>) -> item_service::AddItemsResult {
    let conn = db.get_conn();
    item_service::add_items(&conn, paths)
}

#[tauri::command]
pub fn remove_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::remove_item(&conn, id)
}

#[tauri::command]
pub fn update_item_icon(
    db: State<Database>,
    item_id: i64,
    icon_path: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::update_item_icon(&conn, item_id, icon_path)
}

#[tauri::command]
pub fn get_items(app: AppHandle, db: State<Database>) -> Result<Vec<ItemWithTags>, String> {
    let conn = db.get_conn();
    item_service::get_items(&app, &conn)
}

#[tauri::command]
pub fn get_item(
    app: AppHandle,
    db: State<Database>,
    id: i64,
) -> Result<ItemWithTags, String> {
    let conn = db.get_conn();
    item_service::get_item(&app, &conn, id)
}

#[tauri::command]
pub fn get_items_by_ids(
    app: AppHandle,
    db: State<Database>,
    ids: Vec<i64>,
) -> Result<Vec<ItemWithTags>, String> {
    let conn = db.get_conn();
    item_service::get_items_by_ids(&app, &conn, &ids)
}

#[tauri::command]
pub fn toggle_favorite(db: State<Database>, id: i64) -> Result<bool, String> {
    let conn = db.get_conn();
    item_service::toggle_favorite(&conn, id)
}

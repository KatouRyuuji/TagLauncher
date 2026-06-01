use crate::db::Database;
use crate::models::{Cabinet, ItemWithTags};
use crate::services::cabinet_service;
use crate::services::item_service;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_cabinets(db: State<Database>) -> Result<Vec<Cabinet>, String> {
    let conn = db.get_conn();
    cabinet_service::get_cabinets(&conn)
}

#[tauri::command]
pub fn add_cabinet(db: State<Database>, name: String, color: String) -> Result<Cabinet, String> {
    let conn = db.get_conn();
    cabinet_service::add_cabinet(&conn, &name, &color)
}

#[tauri::command]
pub fn update_cabinet(
    db: State<Database>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::update_cabinet(&conn, id, &name, &color)
}

#[tauri::command]
pub fn remove_cabinet(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::remove_cabinet(&conn, id)
}

#[tauri::command]
pub fn add_item_to_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_id: i64,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::add_item_to_cabinet(&conn, cabinet_id, item_id)
}

#[tauri::command]
pub fn remove_item_from_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_id: i64,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::remove_item_from_cabinet(&conn, cabinet_id, item_id)
}

#[tauri::command]
pub fn get_cabinet_items(
    app: AppHandle,
    db: State<Database>,
    cabinet_id: i64,
) -> Result<Vec<ItemWithTags>, String> {
    let conn = db.get_conn();
    // 刷新即对账：与全部项目视图一致，进入文件柜时也自动更新位置/失效态。
    let _ = item_service::reconcile_items(&conn);
    cabinet_service::get_cabinet_items(&app, &conn, cabinet_id)
}

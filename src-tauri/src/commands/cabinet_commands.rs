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

/// 批量将项目加入文件柜（整批一个事务，幂等）
#[tauri::command]
pub fn add_items_to_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::add_items_to_cabinet(&conn, cabinet_id, &item_ids)
}

/// 批量从文件柜移除项目（单条 IN 语句，原子）
#[tauri::command]
pub fn remove_items_from_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::remove_items_from_cabinet(&conn, cabinet_id, &item_ids)
}

#[tauri::command]
pub fn get_cabinet_items(
    app: AppHandle,
    db: State<Database>,
    cabinet_id: i64,
) -> Result<Vec<ItemWithTags>, String> {
    // 与 get_items 一致：锁内查库（含对账），释放锁后再补图标，避免锁内重 IO。
    let mut items = {
        let conn = db.get_conn();
        let _ = item_service::reconcile_items(&conn);
        cabinet_service::get_cabinet_items(&conn, cabinet_id)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
}

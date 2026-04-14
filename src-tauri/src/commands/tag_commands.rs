use crate::db::Database;
use crate::models::Tag;
use crate::services::tag_service;
use tauri::State;

#[tauri::command]
pub fn get_tags(db: State<Database>) -> Result<Vec<Tag>, String> {
    let conn = db.get_conn();
    tag_service::get_tags(&conn)
}

#[tauri::command]
pub fn add_tag(db: State<Database>, name: String, color: String) -> Result<Tag, String> {
    let conn = db.get_conn();
    tag_service::add_tag(&conn, &name, &color)
}

#[tauri::command]
pub fn update_tag(db: State<Database>, id: i64, name: String, color: String) -> Result<(), String> {
    let conn = db.get_conn();
    tag_service::update_tag(&conn, id, &name, &color)
}

#[tauri::command]
pub fn remove_tag(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    tag_service::remove_tag(&conn, id)
}

#[tauri::command]
pub fn set_item_tags(db: State<Database>, item_id: i64, tag_ids: Vec<i64>) -> Result<(), String> {
    let conn = db.get_conn();
    tag_service::set_item_tags(&conn, item_id, &tag_ids)
}

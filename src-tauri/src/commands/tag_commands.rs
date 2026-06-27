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

// ─────────────────────────────────────────────────────────────────────────
// 标签层级关系（DAG，多继承）
// ─────────────────────────────────────────────────────────────────────────

/// 父子关系边（camelCase 序列化给前端）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRelationDto {
    pub parent_id: i64,
    pub child_id: i64,
}

#[tauri::command]
pub fn get_tag_relations(db: State<Database>) -> Result<Vec<TagRelationDto>, String> {
    let conn = db.get_conn();
    Ok(tag_service::get_tag_relations(&conn)?
        .into_iter()
        .map(|(parent_id, child_id)| TagRelationDto { parent_id, child_id })
        .collect())
}

#[tauri::command]
pub fn add_tag_relation(db: State<Database>, parent_id: i64, child_id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    tag_service::add_tag_relation(&conn, parent_id, child_id)
}

#[tauri::command]
pub fn remove_tag_relation(db: State<Database>, parent_id: i64, child_id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    tag_service::remove_tag_relation(&conn, parent_id, child_id)
}

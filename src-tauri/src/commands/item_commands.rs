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
    let mut conn = db.get_conn();
    item_service::add_items(&mut conn, paths)
}

#[tauri::command]
pub fn remove_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::remove_item(&conn, id)
}

/// 批量删除项目（单条 IN 语句，原子）
#[tauri::command]
pub fn remove_items(db: State<Database>, ids: Vec<i64>) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::remove_items(&conn, &ids)
}

/// 批量设置多个对象的标签（整批一个事务，原子）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTagsChange {
    pub item_id: i64,
    pub tag_ids: Vec<i64>,
}

#[tauri::command]
pub fn set_many_item_tags(
    db: State<Database>,
    changes: Vec<ItemTagsChange>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let pairs: Vec<(i64, Vec<i64>)> = changes
        .into_iter()
        .map(|c| (c.item_id, c.tag_ids))
        .collect();
    crate::services::tag_service::set_many_item_tags(&conn, &pairs)
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
    // 锁内只做 DB 工作（对账 + 查询），随后释放锁再补图标，
    // 避免在持有全局 DB 锁期间串行执行 PowerShell 图标提取等重 IO 阻塞其它命令。
    let mut items = {
        let conn = db.get_conn();
        // 刷新即对账：检测移动/重命名并自动更新位置，找不到的标记为失效；失败不阻断加载。
        let _ = item_service::reconcile_items(&conn);
        item_service::get_items(&conn)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
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

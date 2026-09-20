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
#[tauri::command(async)]
pub fn add_items_to_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::add_items_to_cabinet(&conn, cabinet_id, &item_ids)
}

/// 批量从文件柜移除项目（500 分块多条 IN 语句 + 单事务，整体原子）
#[tauri::command(async)]
pub fn remove_items_from_cabinet(
    db: State<Database>,
    cabinet_id: i64,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.get_conn();
    cabinet_service::remove_items_from_cabinet(&conn, cabinet_id, &item_ids)
}

/// 各文件柜成员计数（轻量单查询，侧栏徽标热路径，不做对账与图标补齐）
#[tauri::command]
pub fn get_cabinet_item_counts(db: State<Database>) -> Result<Vec<(i64, i64)>, String> {
    let conn = db.get_conn();
    cabinet_service::get_cabinet_item_counts(&conn)
}

// 与 get_items 对等：列表读取已纯读化，对账统一走 reconcile_runtime（启动首跑 +
// 60s 节流 + 手动触发），不再随每次读取全量扫盘。
// 函数体全同步（无 await），DB 锁只在各短临界区内持有并随即释放，无跨 await 持锁。
#[tauri::command(async)]
pub fn get_cabinet_items(
    app: AppHandle,
    db: State<Database>,
    cabinet_id: i64,
    include_visuals: Option<bool>,
) -> Result<Vec<ItemWithTags>, String> {
    let mut items = {
        let conn = db.get_conn();
        cabinet_service::get_cabinet_items(&conn, cabinet_id)?
    };
    if include_visuals.unwrap_or(true) {
        item_service::fill_visuals(&app, &mut items);
    }
    Ok(items)
}

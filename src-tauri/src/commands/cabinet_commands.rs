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

// 与 get_items 对等：同样会串行抽图标 + 对账重 IO，用 (async) 放到工作线程避免冻结 UI；
// 函数体全同步（无 await），DB 锁只在各短临界区内持有并随即释放，无跨 await 持锁。
#[tauri::command(async)]
pub fn get_cabinet_items(
    app: AppHandle,
    db: State<Database>,
    cabinet_id: i64,
) -> Result<Vec<ItemWithTags>, String> {
    // 与 get_items 完全对等的列表刷新热路径，同样用三段式把对账重 IO 移出全局 DB 锁：
    //   ① 锁内取快照 → ② 释放锁做 exists()/FFI/签名等重 IO 生成写入计划 → ③ 锁内批量回写 + 查询。
    // 随后再次释放锁补图标（PowerShell/文件 IO）。锁只在 ①③ 两段短临界区持有，
    // 逐对象的重 IO 全在锁外完成。对账失败不阻断列表加载。
    let snapshot = {
        let conn = db.get_conn();
        item_service::read_reconcile_snapshot(&conn).unwrap_or_default()
    };
    let writes = item_service::plan_reconcile(snapshot);
    let mut items = {
        let conn = db.get_conn();
        // 对账失败不阻断列表加载（可用性优先，返回未对账数据），但必须留日志便于排查
        if let Err(e) = item_service::apply_reconcile(&conn, &writes) {
            eprintln!("[get_cabinet_items] apply_reconcile 失败（本次返回未对账数据）: {}", e);
        }
        cabinet_service::get_cabinet_items(&conn, cabinet_id)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
}

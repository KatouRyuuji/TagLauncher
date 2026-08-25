use crate::db::Database;
use crate::models::{Item, ItemWithTags};
use crate::services::item_service;
use tauri::{AppHandle, State};

// 拖拽导入：每个文件的 get_identity(FFI) / compute_signature(读文件) / detect_type 是重 IO，
// 用 (async) 放到工作线程执行，避免在主线程同步跑而冻结 UI。函数体全同步（无 await），
// DB 锁只在工作线程内的同步区间持有并随即释放，无跨 await 持锁。
#[tauri::command(async)]
pub fn add_item(db: State<Database>, path: String) -> Result<Item, String> {
    // 与批量版（item_service::add_items）同一校验：空路径落库会产生无名无定位能力的垃圾行。
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    let conn = db.get_conn();
    item_service::add_item(&conn, &path)
}

// 批量拖入大量文件是重 IO 大头，同样用 (async) 放到工作线程；add_items 的 &mut conn 事务在
// 工作线程内同步执行，函数体无 await，无跨 await 持锁。
#[tauri::command(async)]
pub fn add_items(db: State<Database>, paths: Vec<String>) -> item_service::AddItemsResult {
    let mut conn = db.get_conn();
    item_service::add_items(&mut conn, paths)
}

#[tauri::command]
pub fn remove_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::remove_item(&conn, id)
}

/// 批量删除项目（500 分块多条 IN 语句 + 单事务，整体原子）
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

// 首次加载会串行抽取图标（PowerShell/文件 IO）+ 对账重 IO，是 UI 卡顿大头；用 (async) 放到
// 工作线程执行，不冻结主线程。函数体全同步（无 await），DB 锁只在各短临界区内持有并随即释放，
// 无跨 await 持锁。
#[tauri::command(async)]
pub fn get_items(app: AppHandle, db: State<Database>) -> Result<Vec<ItemWithTags>, String> {
    // 刷新即对账（检测移动/重命名并更新位置、找不到的标记失效），采用三段式把重 IO 移出锁：
    //   ① 锁内取快照 → ② 释放锁做 exists()/FFI/签名等重 IO 生成写入计划 → ③ 锁内批量回写 + 查询。
    // 随后再次释放锁补图标（PowerShell/文件 IO）。锁只在 ①③ 两段短临界区持有，
    // 逐对象的重 IO 全在锁外完成，不再阻塞其它命令。对账失败不阻断列表加载。
    let snapshot = {
        let conn = db.get_conn();
        item_service::read_reconcile_snapshot(&conn).unwrap_or_default()
    };
    let writes = item_service::plan_reconcile(snapshot);
    let mut items = {
        let conn = db.get_conn();
        // 对账失败不阻断列表加载（可用性优先，返回未对账数据），但必须留日志便于排查
        if let Err(e) = item_service::apply_reconcile(&conn, &writes) {
            eprintln!("[get_items] apply_reconcile 失败（本次返回未对账数据）: {}", e);
        }
        item_service::get_items(&conn)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
}

// fill_visuals 在图标未缓存时会跑 PowerShell/文件 IO，同步命令会在主线程执行而冻结 UI，
// 与 get_items 一致用 (async) 放到工作线程。函数体全同步（无 await），无跨 await 持锁。
#[tauri::command(async)]
pub fn get_item(
    app: AppHandle,
    db: State<Database>,
    id: i64,
) -> Result<ItemWithTags, String> {
    // 锁内只取数据，释放锁后再补图标（PowerShell/文件 IO），避免阻塞其它命令。
    let mut item = {
        let conn = db.get_conn();
        item_service::get_item(&conn, id)?
    };
    item_service::fill_visuals(&app, std::slice::from_mut(&mut item));
    Ok(item)
}

// 同 get_item：锁外补图标的重 IO 不能跑在主线程，用 (async) 放到工作线程。
#[tauri::command(async)]
pub fn get_items_by_ids(
    app: AppHandle,
    db: State<Database>,
    ids: Vec<i64>,
) -> Result<Vec<ItemWithTags>, String> {
    let mut items = {
        let conn = db.get_conn();
        item_service::get_items_by_ids(&conn, &ids)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
}

#[tauri::command]
pub fn toggle_favorite(db: State<Database>, id: i64) -> Result<bool, String> {
    let conn = db.get_conn();
    item_service::toggle_favorite(&conn, id)
}

/// 对失效对象按内容签名做跨盘符兜底找回，返回成功找回数量。
/// 扫描阶段在锁外执行：先取数据释放锁 → 扫描候选盘 → 再加锁回写，避免长扫描阻塞其它命令。
/// 全盘扫描是重 IO，用 (async) 放到工作线程；函数体无 await，DB 锁只在取数据/回写两小段内持有。
#[tauri::command(async)]
pub fn relocate_missing(db: State<Database>) -> Result<usize, String> {
    let rows = {
        let conn = db.get_conn();
        item_service::read_missing_signatures(&conn)?
    };
    if rows.is_empty() {
        return Ok(0);
    }
    let found = item_service::scan_for_signatures(&rows);
    if found.is_empty() {
        return Ok(0);
    }
    let conn = db.get_conn();
    item_service::apply_signature_relocations(&conn, &found)
}

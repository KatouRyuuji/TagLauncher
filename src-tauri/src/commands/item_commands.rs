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

// 批量拖入大量文件是重 IO 大头，同样用 (async) 放到工作线程；add_items 内部两段式：
// 锁外逐文件采集元数据（重 IO）→ 锁内单事务批量写库，重 IO 期间不持有全局 DB 锁。
#[tauri::command(async)]
pub fn add_items(db: State<Database>, paths: Vec<String>) -> item_service::AddItemsResult {
    item_service::add_items(&db, paths)
}

#[tauri::command]
pub fn remove_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::remove_item(&conn, id)
}

/// 批量删除项目（500 分块多条 IN 语句 + 单事务，整体原子）
#[tauri::command(async)]
pub fn remove_items(db: State<Database>, ids: Vec<i64>) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::remove_items(&conn, &ids)
}

/// 将源文件移到回收站后再出库。文件系统 IO 放工作线程，避免卡住 UI。
#[tauri::command(async)]
pub fn remove_items_and_files(
    db: State<Database>,
    ids: Vec<i64>,
) -> Result<item_service::RemoveItemsAndFilesResult, String> {
    let conn = db.get_conn();
    item_service::remove_items_and_files(&conn, &ids)
}

/// 导入前区分文件与文件夹，供「加文件夹本身 / 展开夹内文件」对话框使用。
#[tauri::command(async)]
pub fn classify_import_paths(paths: Vec<String>) -> crate::services::import_paths::ImportPathClass {
    crate::services::import_paths::classify_import_paths(paths)
}

/// 把文件夹递归展开为文件路径；已是文件的项原样保留。
#[tauri::command(async)]
pub fn expand_folder_import(paths: Vec<String>) -> crate::services::import_paths::ExpandFolderImportResult {
    crate::services::import_paths::expand_folder_import(paths)
}

/// 批量设置多个对象的标签（整批一个事务，原子）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTagsChange {
    pub item_id: i64,
    pub tag_ids: Vec<i64>,
}

#[tauri::command(async)]
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

// 首次加载会串行抽取图标（PowerShell/文件 IO），用 (async) 放到工作线程执行，不冻结主线程。
// 函数体全同步（无 await），DB 锁只在各短临界区内持有并随即释放，无跨 await 持锁。
// 对账已解耦到 reconcile_runtime（启动首跑 + 60s 节流 + 手动触发），本命令纯读库，
// 不再为每次读取付出全量 exists() 扫盘成本。
#[tauri::command(async)]
pub fn get_items(app: AppHandle, db: State<Database>, include_visuals: Option<bool>) -> Result<Vec<ItemWithTags>, String> {
    let mut items = {
        let conn = db.get_conn();
        item_service::get_items(&conn)?
    };
    if include_visuals.unwrap_or(true) {
        item_service::fill_visuals(&app, &mut items);
    }
    Ok(items)
}

/// 手动/测试触发的对账。wait=true 同步跑完返回摘要（perf 脚本测 reconcile_ms）；
/// wait=false（默认）经 reconcile_runtime 调度（60s 节流、in_flight 防重入），
/// 有写入时另行 emit items-reconciled。
#[tauri::command(async)]
pub fn reconcile_items(
    app: AppHandle,
    force: Option<bool>,
    wait: Option<bool>,
) -> Result<crate::services::reconcile_runtime::ReconcileSummary, String> {
    use crate::services::reconcile_runtime as runtime;
    if wait.unwrap_or(false) {
        let summary = runtime::run_sweep(&app)?;
        if summary.changed {
            use tauri::Emitter;
            let _ = app.emit("items-reconciled", summary.clone());
        }
        return Ok(summary);
    }
    let started = runtime::request_reconcile(&app, force.unwrap_or(false));
    Ok(crate::services::reconcile_runtime::ReconcileSummary {
        changed: started,
        marked_missing: 0,
        relocated: 0,
        cleared: 0,
        elapsed_ms: 0,
    })
}

/// 手动刷新时清除图标失败标记（.none），下一次取图立即重试而不等负缓存冷却。
#[tauri::command(async)]
pub fn clear_icon_none_markers(app: AppHandle) -> Result<(), String> {
    crate::services::icon_service::clear_none_markers(&app)
}

#[derive(serde::Serialize)]
pub struct ItemVisual {
    path: String,
    icon_path: Option<String>,
}

/// 根据库内对象读取图标，文件和 Shell 操作在数据库锁外执行。
#[tauri::command(async)]
pub fn get_item_visual(app: AppHandle, db: State<Database>, id: i64) -> Result<ItemVisual, String> {
    let mut item = {
        let conn = db.get_conn();
        item_service::select_item_by_id(&conn, id)?
    };
    if !item.is_missing {
        crate::services::icon_service::fill_item_visual(&app, &mut item);
    }
    Ok(ItemVisual { path: item.path, icon_path: item.icon_path })
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
    include_visuals: Option<bool>,
) -> Result<Vec<ItemWithTags>, String> {
    let mut items = {
        let conn = db.get_conn();
        item_service::get_items_by_ids(&conn, &ids)?
    };
    if include_visuals.unwrap_or(true) {
        item_service::fill_visuals(&app, &mut items);
    }
    Ok(items)
}

#[tauri::command]
pub fn toggle_favorite(db: State<Database>, id: i64) -> Result<bool, String> {
    let conn = db.get_conn();
    item_service::toggle_favorite(&conn, id)
}

/// 批量设置收藏状态（单事务，批量收藏热路径）
#[tauri::command(async)]
pub fn set_favorites(db: State<Database>, ids: Vec<i64>, favorite: bool) -> Result<(), String> {
    let conn = db.get_conn();
    item_service::set_favorites(&conn, &ids, favorite)
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
    let found = item_service::scan_for_signatures(&rows)?;
    if found.is_empty() {
        return Ok(0);
    }
    let writes = item_service::plan_signature_relocations(&rows, &found);
    let conn = db.get_conn();
    item_service::apply_signature_relocations(&conn, &writes)
}

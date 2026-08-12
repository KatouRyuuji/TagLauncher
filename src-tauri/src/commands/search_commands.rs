use crate::db::Database;
use crate::models::ItemWithTags;
use crate::services::{item_service, search_service};
use tauri::{AppHandle, State};

// fill_visuals 在图标未缓存时会跑 PowerShell/文件 IO，同步命令会在主线程执行而冻结 UI，
// 与 get_items 一致用 (async) 放到工作线程。函数体全同步（无 await），无跨 await 持锁。
#[tauri::command(async)]
pub fn search_items(
    app: AppHandle,
    db: State<Database>,
    query: String,
    tag_ids: Vec<i64>,
) -> Result<Vec<ItemWithTags>, String> {
    // 锁内查询，锁外补图标，避免持锁期间执行图标提取等重 IO。
    let mut items = {
        let conn = db.get_conn();
        search_service::search_items(&conn, &query, &tag_ids)?
    };
    item_service::fill_visuals(&app, &mut items);
    Ok(items)
}

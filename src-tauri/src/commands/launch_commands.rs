use crate::db::Database;
use crate::services::launch_service;
use tauri::State;

#[tauri::command]
pub fn launch_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    launch_service::launch_item(&conn, id)
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    launch_service::open_in_explorer(&path)
}

/// 按对象 id 打开所在文件夹：先按文件ID重定位到当前真实路径，避免路径已失效。
#[tauri::command]
pub fn open_in_explorer_by_id(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.get_conn();
    launch_service::open_in_explorer_by_id(&conn, id)
}

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

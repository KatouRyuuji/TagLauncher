use crate::db::Database;
use crate::services::watch_runtime::FolderWatchHub;
use crate::services::watch_service::{self, FolderWatchStatus};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn get_folder_watch_status(db: State<Database>) -> Result<FolderWatchStatus, String> {
    let conn = db.get_conn();
    watch_service::status(&conn)
}

#[tauri::command]
pub fn set_folder_watch_master(
    app: AppHandle,
    db: State<Database>,
    enabled: bool,
) -> Result<FolderWatchStatus, String> {
    crate::db::ensure_writes_allowed()?;
    {
        let conn = db.get_conn();
        watch_service::set_master_enabled(&conn, enabled)?;
    }
    app.state::<FolderWatchHub>().reload(&app);
    let conn = db.get_conn();
    watch_service::status(&conn)
}

#[tauri::command]
pub fn set_folder_watch(
    app: AppHandle,
    db: State<Database>,
    item_id: i64,
    enabled: bool,
) -> Result<FolderWatchStatus, String> {
    crate::db::ensure_writes_allowed()?;
    {
        let conn = db.get_conn();
        watch_service::set_item_watch(&conn, item_id, enabled)?;
    }
    if enabled {
        let _ = watch_service::scan_root(&db, item_id);
    }
    app.state::<FolderWatchHub>().reload(&app);
    let conn = db.get_conn();
    watch_service::status(&conn)
}

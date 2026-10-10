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
        let _ = watch_service::scan_root(&db, watch_service::RootKey::Item(item_id));
    }
    app.state::<FolderWatchHub>().reload(&app);
    let conn = db.get_conn();
    watch_service::status(&conn)
}

/// 忽略名单；under 为某个监视目录时只列其下的项。
#[tauri::command]
pub fn list_ignored_paths(db: State<Database>, under: Option<String>) -> Result<Vec<String>, String> {
    let conn = db.get_conn();
    watch_service::list_ignored_paths(&conn, under.as_deref())
}

/// 恢复追踪：移出忽略名单后重载监视，随即补扫把它们重新导入。
#[tauri::command]
pub fn restore_ignored_paths(
    app: AppHandle,
    db: State<Database>,
    paths: Vec<String>,
) -> Result<(), String> {
    {
        let conn = db.get_conn();
        watch_service::restore_ignored_paths(&conn, &paths)?;
    }
    app.state::<FolderWatchHub>().reload(&app);
    Ok(())
}

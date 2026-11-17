use crate::db::Database;
use crate::services::{item_service, launch_service};
use tauri::State;

// launch/open 路径会做同步 FFI（CreateFileW 身份校验、失效时枚举卷），
// 网络盘场景可达数百 ms，用 (async) 放到工作线程避免冻结 UI；
// 函数体全同步（无 await），DB 锁只在短临界区内持有并随即释放，不覆盖 ShellExecute。

#[tauri::command(async)]
pub fn launch_item(db: State<Database>, id: i64) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    let prep = {
        let conn = db.get_conn();
        launch_service::prepare_launch(&conn, id)?
    };
    match launch_service::open_prepared(&prep.path) {
        Ok(()) => {
            let conn = db.get_conn();
            launch_service::record_launch_success(&conn, prep.id)
        }
        Err(e) => {
            let conn = db.get_conn();
            launch_service::on_launch_open_failed(&conn, &prep, e)
        }
    }
}

#[tauri::command(async)]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    launch_service::open_in_explorer(&path)
}

/// 按对象 id 打开所在文件夹：先按文件ID重定位到当前真实路径，避免路径已失效。
/// 重定位在锁内完成，打开资源管理器在锁外。
#[tauri::command(async)]
pub fn open_in_explorer_by_id(db: State<Database>, id: i64) -> Result<(), String> {
    let path = {
        let conn = db.get_conn();
        item_service::resolve_current_path(&conn, id)?
    };
    launch_service::open_in_explorer(&path)
}

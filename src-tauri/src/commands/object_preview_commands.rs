use crate::db::Database;
use crate::services::{asset_scope, launch_service, object_preview_service};
use rusqlite::Connection;
use tauri::{AppHandle, State};

// 各命令均做同步文件 IO（目录枚举/音频解析），用 (async) 放到工作线程避免冻结 UI；
// 函数体全同步（无 await）。先用短锁核对路径属于库内对象，再释放锁做 IO。
// 预览读取前顺带放行该对象的 asset 范围（文件本身 / 文件夹递归）：列表的空闲补齐
// （get_items_page warm）只放行卡片要直接显示的路径，预览与 Mod 的 toAssetUrl 都先走这里。

#[tauri::command(async)]
pub fn get_object_file_info(
    app: AppHandle,
    db: State<Database>,
    path: String,
) -> Result<object_preview_service::ObjectFileInfo, String> {
    allow_preview(&app, &db, &path)?;
    object_preview_service::get_object_file_info(&path)
}

#[tauri::command(async)]
pub fn list_object_directory(
    app: AppHandle,
    db: State<Database>,
    path: String,
) -> Result<Vec<object_preview_service::ObjectDirectoryEntry>, String> {
    allow_preview(&app, &db, &path)?;
    object_preview_service::list_object_directory(&path)
}

#[tauri::command(async)]
pub fn get_audio_preview(
    app: AppHandle,
    db: State<Database>,
    path: String,
) -> Result<object_preview_service::AudioPreviewInfo, String> {
    allow_preview(&app, &db, &path)?;
    object_preview_service::get_audio_preview(&path)
}

/// 用系统关联程序打开库内文件夹对象之下的文件或子目录（预览下钻时的「打开」）。
#[tauri::command(async)]
pub fn open_object_path(db: State<Database>, path: String) -> Result<(), String> {
    assert_registered_preview_path(&db, &path)?;
    launch_service::open_path(path.trim())
}

fn assert_registered_preview_path(db: &Database, path: &str) -> Result<(), String> {
    registered_preview_owner(db, path).map(|_| ())
}

/// 核对路径属于库内对象，返回所属对象的路径（等于该对象，或在该文件夹对象之下）
fn registered_preview_owner(db: &Database, path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let owner = {
        let conn = db.get_conn();
        registered_preview_item(&conn, trimmed)?
    };
    owner.ok_or_else(|| "只能预览库内已登记对象及其子路径".to_string())
}

/// 核对并放行所属对象的 asset 范围（已放行的集合去重，重复调用不再编译 glob）
fn allow_preview(app: &AppHandle, db: &Database, path: &str) -> Result<(), String> {
    let owner = registered_preview_owner(db, path)?;
    asset_scope::allow_item_visual(app, &owner, false, None);
    Ok(())
}

/// 路径必须等于某条库记录，或落在已登记文件夹对象之下；含相对段的路径一律拒绝，
/// 防止 `D:\Games\..\Windows` 这类写法借前缀比较越出对象目录。
#[cfg(test)]
fn is_registered_preview_path(conn: &Connection, path: &str) -> Result<bool, String> {
    registered_preview_item(conn, path).map(|owner| owner.is_some())
}

fn registered_preview_item(conn: &Connection, path: &str) -> Result<Option<String>, String> {
    if has_relative_segment(path) {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare("SELECT path, type FROM items")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (item_path, item_type) = row.map_err(|e| e.to_string())?;
        if paths_equal(&item_path, path)
            || (item_type == "folder" && is_under_dir(&item_path, path))
        {
            return Ok(Some(item_path));
        }
    }
    Ok(None)
}

/// 只由点和空格组成的段（`.`、`..`、`.. ` 等）：Win32 会去掉段尾的点和空格，
/// 这些段最终都按当前或上级目录解析。
fn has_relative_segment(path: &str) -> bool {
    path.split(['\\', '/'])
        .any(|segment| !segment.is_empty() && segment.chars().all(|c| c == '.' || c == ' '))
}

fn normalize_path_key(path: &str) -> String {
    path.trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn paths_equal(left: &str, right: &str) -> bool {
    normalize_path_key(left) == normalize_path_key(right)
}

fn is_under_dir(dir: &str, path: &str) -> bool {
    let dir_key = normalize_path_key(dir);
    let path_key = normalize_path_key(path);
    !dir_key.is_empty() && path_key.starts_with(&(dir_key + "\\"))
}

#[cfg(test)]
mod tests {
    use super::{
        has_relative_segment, is_registered_preview_path, is_under_dir, paths_equal,
        registered_preview_item,
    };
    use rusqlite::Connection;

    #[test]
    fn relative_segments_are_detected() {
        assert!(has_relative_segment(r"D:\Games\..\Windows"));
        assert!(has_relative_segment(r"D:\Games\.\foo.exe"));
        assert!(has_relative_segment(r"D:/Games/.. /Windows"));
        assert!(has_relative_segment(r"D:\Games\..."));
        assert!(!has_relative_segment(r"D:\Games\.hidden\v1.2..txt"));
        assert!(!has_relative_segment(r"\\server\share\a"));
    }

    #[test]
    fn registered_check_rejects_escape_through_parent_segment() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES ('Games', 'D:\\Games', 'folder')",
            [],
        )
        .unwrap();
        assert!(is_registered_preview_path(&conn, r"D:\Games\sub\a.txt").unwrap());
        assert!(!is_registered_preview_path(&conn, r"D:\Games\..\Windows").unwrap());
        assert!(
            !is_registered_preview_path(&conn, r"D:\Games\sub\..\..\Windows\notepad.exe").unwrap()
        );
        assert!(!is_registered_preview_path(&conn, r"D:\Other\a.txt").unwrap());
        // 放行范围按所属对象：子路径归到登记的文件夹对象
        assert_eq!(
            registered_preview_item(&conn, r"d:/games/sub/a.txt")
                .unwrap()
                .as_deref(),
            Some(r"D:\Games")
        );
    }

    #[test]
    fn path_equality_is_slash_and_case_insensitive() {
        assert!(paths_equal(r"D:\Games\Unity Hub.lnk", r"d:/Games/Unity Hub.lnk"));
        assert!(!paths_equal(r"D:\Games\a.lnk", r"D:\Games\b.lnk"));
    }

    #[test]
    fn folder_prefix_does_not_match_sibling_name() {
        assert!(is_under_dir(r"D:\Games", r"D:\Games\foo.exe"));
        assert!(!is_under_dir(r"D:\Games", r"D:\GamesBackup\foo.exe"));
        assert!(!is_under_dir(r"D:\Games", r"D:\Games"));
    }
}

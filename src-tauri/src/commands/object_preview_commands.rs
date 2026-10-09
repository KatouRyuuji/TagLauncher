use crate::db::Database;
use crate::services::{launch_service, object_preview_service};
use rusqlite::Connection;
use tauri::State;

// 各命令均做同步文件 IO（目录枚举/音频解析），用 (async) 放到工作线程避免冻结 UI；
// 函数体全同步（无 await）。先用短锁核对路径属于库内对象，再释放锁做 IO。

#[tauri::command(async)]
pub fn get_object_file_info(
    db: State<Database>,
    path: String,
) -> Result<object_preview_service::ObjectFileInfo, String> {
    assert_registered_preview_path(&db, &path)?;
    object_preview_service::get_object_file_info(&path)
}

#[tauri::command(async)]
pub fn list_object_directory(
    db: State<Database>,
    path: String,
) -> Result<Vec<object_preview_service::ObjectDirectoryEntry>, String> {
    assert_registered_preview_path(&db, &path)?;
    object_preview_service::list_object_directory(&path)
}

#[tauri::command(async)]
pub fn get_audio_preview(
    db: State<Database>,
    path: String,
) -> Result<object_preview_service::AudioPreviewInfo, String> {
    assert_registered_preview_path(&db, &path)?;
    object_preview_service::get_audio_preview(&path)
}

/// 用系统关联程序打开库内文件夹对象之下的文件或子目录（预览下钻时的「打开」）。
#[tauri::command(async)]
pub fn open_object_path(db: State<Database>, path: String) -> Result<(), String> {
    assert_registered_preview_path(&db, &path)?;
    launch_service::open_path(path.trim())
}

fn assert_registered_preview_path(db: &Database, path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let allowed = {
        let conn = db.get_conn();
        is_registered_preview_path(&conn, trimmed)?
    };
    if !allowed {
        return Err("只能预览库内已登记对象及其子路径".to_string());
    }
    Ok(())
}

/// 路径必须等于某条库记录，或落在已登记文件夹对象之下；含相对段的路径一律拒绝，
/// 防止 `D:\Games\..\Windows` 这类写法借前缀比较越出对象目录。
fn is_registered_preview_path(conn: &Connection, path: &str) -> Result<bool, String> {
    if has_relative_segment(path) {
        return Ok(false);
    }
    let mut stmt = conn
        .prepare("SELECT path, type FROM items")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (item_path, item_type) = row.map_err(|e| e.to_string())?;
        if paths_equal(&item_path, path) {
            return Ok(true);
        }
        if item_type == "folder" && is_under_dir(&item_path, path) {
            return Ok(true);
        }
    }
    Ok(false)
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
    use super::{has_relative_segment, is_registered_preview_path, is_under_dir, paths_equal};
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

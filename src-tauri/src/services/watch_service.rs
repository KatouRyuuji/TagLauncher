use std::collections::HashSet;
use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;

use crate::services::item_service::{AddItemFailure, AddItemsResult};
use crate::services::settings_service;

pub const MASTER_KEY: &str = "folder_watch_master";

/// 单个监视根全量补扫的文件数上限（手动导入另有 FOLDER_IMPORT_FILE_CAP）。
pub const WATCH_SCAN_CAP: usize = 50_000;
/// 全量补扫每批交给 add_items 的路径数。
const SCAN_ADD_CHUNK: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderWatchStatus {
    pub master_enabled: bool,
    pub active_count: i64,
    pub watched_item_ids: Vec<i64>,
}

pub fn master_enabled(conn: &Connection) -> bool {
    !matches!(settings_service::get_setting(conn, MASTER_KEY).as_deref(), Some("0"))
}

pub fn set_master_enabled(conn: &Connection, enabled: bool) -> Result<(), String> {
    settings_service::set_setting(conn, MASTER_KEY, if enabled { "1" } else { "0" })
}

pub fn set_item_watch(conn: &Connection, item_id: i64, enabled: bool) -> Result<(), String> {
    if enabled {
        let (item_type, missing): (String, i64) = conn
            .query_row(
                "SELECT type, is_missing FROM items WHERE id = ?1",
                [item_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "对象不存在".to_string())?;
        if item_type != "folder" {
            return Err("只能监视文件夹对象".to_string());
        }
        if missing != 0 {
            return Err("失效的文件夹不能打开监视".to_string());
        }
        conn.execute(
            "INSERT INTO watch_roots (item_id, enabled, recursive) VALUES (?1, 1, 1)
             ON CONFLICT(item_id) DO UPDATE SET enabled = 1",
            [item_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE watch_roots SET enabled = 0 WHERE item_id = ?1", [item_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_active_roots(conn: &Connection) -> Result<Vec<(i64, String)>, String> {
    if !master_enabled(conn) {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.path FROM watch_roots w
             JOIN items i ON i.id = w.item_id
             WHERE w.enabled = 1 AND i.type = 'folder' AND i.is_missing = 0",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn root_is_active(conn: &Connection, item_id: i64) -> bool {
    if !master_enabled(conn) {
        return false;
    }
    conn.query_row(
        "SELECT 1 FROM watch_roots w
         JOIN items i ON i.id = w.item_id
         WHERE w.item_id = ?1 AND w.enabled = 1 AND i.type = 'folder' AND i.is_missing = 0",
        [item_id],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

pub fn status(conn: &Connection) -> Result<FolderWatchStatus, String> {
    let master = master_enabled(conn);
    let mut stmt = conn
        .prepare("SELECT item_id FROM watch_roots WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let watched_item_ids = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<i64>, _>>()
        .map_err(|e| e.to_string())?;
    let active_count = if master {
        list_active_roots(conn)?.len() as i64
    } else {
        0
    };
    Ok(FolderWatchStatus {
        master_enabled: master,
        active_count,
        watched_item_ids,
    })
}

fn mark_scanned(conn: &Connection, item_id: i64) {
    let _ = conn.execute(
        "UPDATE watch_roots SET last_scan_at = CURRENT_TIMESTAMP WHERE item_id = ?1",
        [item_id],
    );
}

fn empty_add_result() -> AddItemsResult {
    AddItemsResult {
        items: Vec::new(),
        failed: Vec::<AddItemFailure>::new(),
        created_count: 0,
    }
}

fn path_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

/// 库里路径位于 root 下的对象（按 Windows 不区分大小写比较），用于补扫时只采集新文件。
fn known_paths_under(conn: &Connection, root: &str) -> Result<HashSet<String>, String> {
    let mut prefix = path_key(root);
    if !prefix.ends_with('\\') {
        prefix.push('\\');
    }
    let mut stmt = conn.prepare("SELECT path FROM items").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = HashSet::new();
    for row in rows {
        let key = path_key(&row.map_err(|e| e.to_string())?);
        if key.starts_with(&prefix) {
            out.insert(key);
        }
    }
    Ok(out)
}

fn active_root_path(db: &crate::db::Database, item_id: i64) -> Result<Option<String>, String> {
    let conn = db.get_conn();
    if !root_is_active(&conn, item_id) {
        return Ok(None);
    }
    conn.query_row("SELECT path FROM items WHERE id = ?1", [item_id], |r| r.get(0))
        .map(Some)
        .map_err(|e| e.to_string())
}

/// 对单个监视根做一次全量补扫：遍历（上限 WATCH_SCAN_CAP）后只把库里没有的路径交给 add_items。
/// 根目录不存在（盘离线）时直接返回空结果，不报错。
pub fn scan_root(db: &crate::db::Database, item_id: i64) -> Result<AddItemsResult, String> {
    crate::db::ensure_writes_allowed()?;
    let Some(root) = active_root_path(db, item_id)? else {
        return Ok(empty_add_result());
    };
    if !Path::new(&root).is_dir() {
        return Ok(empty_add_result());
    }
    let (files, truncated) =
        crate::services::import_paths::walk_folder_files(Path::new(&root), WATCH_SCAN_CAP);
    if truncated {
        log::warn!("[folder-watch] 根 {item_id} 超过 {WATCH_SCAN_CAP} 个文件，超出部分未同步");
    }
    let known = {
        let conn = db.get_conn();
        known_paths_under(&conn, &root)?
    };
    let fresh: Vec<String> = files
        .into_iter()
        .filter(|path| !known.contains(&path_key(path)))
        .collect();
    // 分批入库：首次绑定大目录时避免单个事务长时间独占数据库锁
    let mut result = empty_add_result();
    for chunk in fresh.chunks(SCAN_ADD_CHUNK) {
        let part = crate::services::item_service::add_items(db, chunk.to_vec());
        result.created_count += part.created_count;
        result.items.extend(part.items);
        result.failed.extend(part.failed);
    }
    {
        let conn = db.get_conn();
        mark_scanned(&conn, item_id);
    }
    Ok(result)
}

/// 把变更通知里的新增/移入路径展开为待入库文件：须位于 root 下，自 root 起每一级都不被跳过规则排除；
/// 文件夹整体移入时只遍历该文件夹。
pub fn expand_event_paths(root: &Path, paths: &[std::path::PathBuf]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let mut current = root.to_path_buf();
        let mut skipped = false;
        for component in relative.components() {
            current.push(component);
            if crate::services::import_paths::is_skipped_entry(&current) {
                skipped = true;
                break;
            }
        }
        if skipped {
            continue;
        }
        let candidates = if path.is_dir() {
            crate::services::import_paths::walk_folder_files(path, WATCH_SCAN_CAP).0
        } else if path.is_file() {
            vec![path.to_string_lossy().to_string()]
        } else {
            Vec::new()
        };
        for candidate in candidates {
            if seen.insert(path_key(&candidate)) {
                out.push(candidate);
            }
        }
    }
    out
}

/// 变更通知触发的增量入库：根须仍处于监视中，路径经 expand_event_paths 过滤。
pub fn import_event_paths(
    db: &crate::db::Database,
    item_id: i64,
    paths: &[std::path::PathBuf],
) -> Result<AddItemsResult, String> {
    crate::db::ensure_writes_allowed()?;
    let Some(root) = active_root_path(db, item_id)? else {
        return Ok(empty_add_result());
    };
    let files = expand_event_paths(Path::new(&root), paths);
    if files.is_empty() {
        return Ok(empty_add_result());
    }
    Ok(crate::services::item_service::add_items(db, files))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn master_defaults_on_and_can_pause() {
        let conn = setup();
        assert!(master_enabled(&conn));
        set_master_enabled(&conn, false).unwrap();
        assert!(!master_enabled(&conn));
    }

    #[test]
    fn only_live_folder_can_enable_watch() {
        let conn = setup();
        conn.execute(
            "INSERT INTO items (id, name, path, type) VALUES (1, 'f', 'D:/f', 'folder')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO items (id, name, path, type) VALUES (2, 'x', 'D:/x.exe', 'exe')",
            [],
        )
        .unwrap();
        assert!(set_item_watch(&conn, 2, true).is_err());
        set_item_watch(&conn, 1, true).unwrap();
        assert_eq!(list_active_roots(&conn).unwrap().len(), 1);
        conn.execute("UPDATE items SET is_missing = 1 WHERE id = 1", []).unwrap();
        assert!(list_active_roots(&conn).unwrap().is_empty());
    }

    #[test]
    fn removing_folder_cascades_watch_root() {
        let conn = setup();
        conn.execute(
            "INSERT INTO items (id, name, path, type) VALUES (1, 'f', 'D:/f', 'folder')",
            [],
        )
        .unwrap();
        set_item_watch(&conn, 1, true).unwrap();
        conn.execute("DELETE FROM items WHERE id = 1", []).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM watch_roots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}

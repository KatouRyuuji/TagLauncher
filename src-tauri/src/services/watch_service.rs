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

/// 监视根：文件夹对象（只收文件）或关联了文件夹的文件柜（文件与子文件夹都收）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootKey {
    Item(i64),
    Cabinet(i64),
}

impl RootKey {
    fn include_dirs(self) -> bool {
        matches!(self, RootKey::Cabinet(_))
    }
}

impl std::fmt::Display for RootKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RootKey::Item(id) => write!(f, "对象 {id}"),
            RootKey::Cabinet(id) => write!(f, "文件柜 {id}"),
        }
    }
}

const ACTIVE_ITEM_ROOTS: &str = "SELECT i.id, i.path FROM watch_roots w
     JOIN items i ON i.id = w.item_id
     WHERE w.enabled = 1 AND i.type = 'folder' AND i.is_missing = 0";
const ACTIVE_CABINET_ROOTS: &str =
    "SELECT id, folder_path FROM cabinets WHERE folder_path IS NOT NULL";

/// 总闸开启时的全部监视根（总闸同时暂停文件夹对象与关联柜的同步）。
pub fn list_active_roots(conn: &Connection) -> Result<Vec<(RootKey, String)>, String> {
    if !master_enabled(conn) {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for (sql, make) in [
        (ACTIVE_ITEM_ROOTS, RootKey::Item as fn(i64) -> RootKey),
        (ACTIVE_CABINET_ROOTS, RootKey::Cabinet as fn(i64) -> RootKey),
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, path) = row.map_err(|e| e.to_string())?;
            out.push((make(id), path));
        }
    }
    Ok(out)
}

/// 根仍处于监视中时返回其路径。
fn active_root_path_conn(conn: &Connection, key: RootKey) -> Option<String> {
    if !master_enabled(conn) {
        return None;
    }
    match key {
        RootKey::Item(id) => conn
            .query_row(&format!("{ACTIVE_ITEM_ROOTS} AND i.id = ?1"), [id], |r| r.get(1))
            .ok(),
        RootKey::Cabinet(id) => conn
            .query_row(&format!("{ACTIVE_CABINET_ROOTS} AND id = ?1"), [id], |r| r.get(1))
            .ok(),
    }
}

pub fn root_is_active(conn: &Connection, key: RootKey) -> bool {
    active_root_path_conn(conn, key).is_some()
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

fn mark_scanned(conn: &Connection, key: RootKey, truncated: bool) {
    let _ = match key {
        RootKey::Item(id) => conn.execute(
            "UPDATE watch_roots SET last_scan_at = CURRENT_TIMESTAMP WHERE item_id = ?1",
            [id],
        ),
        RootKey::Cabinet(id) => conn.execute(
            "UPDATE cabinets SET folder_truncated = ?2 WHERE id = ?1",
            rusqlite::params![id, truncated],
        ),
    };
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

/// 已配置的监视目录（打开了监视的文件夹对象与关联柜的文件夹，不看总闸），用于判断移出库时是否记入忽略名单。
fn configured_root_keys(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT i.path FROM watch_roots w JOIN items i ON i.id = w.item_id WHERE w.enabled = 1
             UNION ALL
             SELECT folder_path FROM cabinets WHERE folder_path IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map(|path| path_key(&path)).map_err(|e| e.to_string()))
        .collect()
}

/// key 等于 prefix 或位于 prefix 之下。
fn key_within(key: &str, prefix: &str) -> bool {
    key == prefix
        || (key.starts_with(prefix)
            && (prefix.ends_with('\\') || key.as_bytes().get(prefix.len()) == Some(&b'\\')))
}

/// 把即将移出库的对象中位于监视目录之下（不含监视目录本身）的路径记入忽略名单；须与删除处于同一事务。
/// 返回被忽略文件夹之下其余已入库对象的 id，调用方一并移出库。
pub fn ignore_removed_items(conn: &Connection, ids: &[i64]) -> Result<Vec<i64>, String> {
    let roots = configured_root_keys(conn)?;
    if roots.is_empty() {
        return Ok(Vec::new());
    }
    let mut select = conn
        .prepare("SELECT path, type FROM items WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let mut insert = conn
        .prepare("INSERT OR IGNORE INTO ignored_paths (path_key, path) VALUES (?1, ?2)")
        .map_err(|e| e.to_string())?;
    let mut folders = Vec::new();
    for id in ids {
        let Ok((path, item_type)) =
            select.query_row([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        else {
            continue;
        };
        let key = path_key(&path);
        if roots.iter().any(|root| key != *root && key_within(&key, root)) {
            insert
                .execute(rusqlite::params![key, path])
                .map_err(|e| e.to_string())?;
            if item_type == "folder" {
                folders.push(key);
            }
        }
    }
    if folders.is_empty() {
        return Ok(Vec::new());
    }
    let requested: HashSet<i64> = ids.iter().copied().collect();
    let mut stmt = conn
        .prepare("SELECT id, path FROM items")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut descendants = Vec::new();
    for row in rows {
        let (id, path) = row.map_err(|e| e.to_string())?;
        let key = path_key(&path);
        if !requested.contains(&id)
            && folders.iter().any(|folder| key != *folder && key_within(&key, folder))
        {
            descendants.push(id);
        }
    }
    Ok(descendants)
}

/// 手动加入库的路径不再被忽略：删除等于该路径或位于其下的忽略项。
pub fn unignore_path(conn: &Connection, path: &str) -> Result<(), String> {
    let key = path_key(path);
    let removed = ignored_keys(conn)?
        .into_iter()
        .filter(|ignored| key_within(ignored, &key));
    for ignored in removed {
        conn.execute("DELETE FROM ignored_paths WHERE path_key = ?1", [ignored])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ignored_keys(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT path_key FROM ignored_paths")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn is_ignored(path: &str, ignored: &[String]) -> bool {
    let key = path_key(path);
    ignored.iter().any(|prefix| key_within(&key, prefix))
}

/// 忽略名单（按路径排序）；给定 under 时只列该目录之下的项。
pub fn list_ignored_paths(conn: &Connection, under: Option<&str>) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT path_key, path FROM ignored_paths ORDER BY path COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let under = under.map(path_key);
    let mut out = Vec::new();
    for row in rows {
        let (key, path) = row.map_err(|e| e.to_string())?;
        if under.as_deref().map_or(true, |root| key != root && key_within(&key, root)) {
            out.push(path);
        }
    }
    Ok(out)
}

/// 恢复追踪：从忽略名单删除这些路径（整批一个事务）。
pub fn restore_ignored_paths(conn: &Connection, paths: &[String]) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for path in paths {
        tx.execute("DELETE FROM ignored_paths WHERE path_key = ?1", [path_key(path)])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// 清理 root 之下磁盘上已不存在的忽略项（只在 root 在线时调用）。存在性检查在锁外进行。
fn prune_ignored_under(db: &crate::db::Database, root: &str) -> Result<(), String> {
    let candidates = {
        let conn = db.get_conn();
        list_ignored_paths(&conn, Some(root))?
    };
    let gone: Vec<String> = candidates
        .into_iter()
        .filter(|path| !Path::new(path).exists())
        .collect();
    if gone.is_empty() {
        return Ok(());
    }
    let conn = db.get_conn();
    restore_ignored_paths(&conn, &gone)
}

fn active_root_path(db: &crate::db::Database, key: RootKey) -> Option<String> {
    let conn = db.get_conn();
    active_root_path_conn(&conn, key)
}

/// 对单个监视根做一次全量补扫：遍历（上限 WATCH_SCAN_CAP）后只把库里没有的路径交给 add_items。
/// 根目录不存在（盘离线）时直接返回空结果，不报错。
pub fn scan_root(db: &crate::db::Database, key: RootKey) -> Result<AddItemsResult, String> {
    crate::db::ensure_writes_allowed()?;
    let Some(root) = active_root_path(db, key) else {
        return Ok(empty_add_result());
    };
    if !Path::new(&root).is_dir() {
        return Ok(empty_add_result());
    }
    let (files, truncated) = crate::services::import_paths::walk_folder_entries(
        Path::new(&root),
        WATCH_SCAN_CAP,
        key.include_dirs(),
    );
    if truncated {
        log::warn!("[folder-watch] {key} 超过 {WATCH_SCAN_CAP} 项，超出部分未同步");
    }
    prune_ignored_under(db, &root)?;
    let (known, ignored) = {
        let conn = db.get_conn();
        (known_paths_under(&conn, &root)?, ignored_keys(&conn)?)
    };
    let fresh: Vec<String> = files
        .into_iter()
        .filter(|path| !known.contains(&path_key(path)) && !is_ignored(path, &ignored))
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
        mark_scanned(&conn, key, truncated);
    }
    Ok(result)
}

/// 把变更通知里的新增/移入路径展开为待入库条目：须位于 root 下，自 root 起每一级都不被跳过规则排除；
/// 文件夹整体移入时只遍历该文件夹（include_dirs 时文件夹本身与其子文件夹也入库）。
pub fn expand_event_paths(
    root: &Path,
    paths: &[std::path::PathBuf],
    include_dirs: bool,
) -> Vec<String> {
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
            let (mut entries, _) = crate::services::import_paths::walk_folder_entries(
                path,
                WATCH_SCAN_CAP,
                include_dirs,
            );
            if include_dirs {
                entries.insert(0, path.to_string_lossy().to_string());
            }
            entries
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
    key: RootKey,
    paths: &[std::path::PathBuf],
) -> Result<AddItemsResult, String> {
    crate::db::ensure_writes_allowed()?;
    let Some(root) = active_root_path(db, key) else {
        return Ok(empty_add_result());
    };
    let ignored = {
        let conn = db.get_conn();
        ignored_keys(&conn)?
    };
    let files: Vec<String> = expand_event_paths(Path::new(&root), paths, key.include_dirs())
        .into_iter()
        .filter(|path| !is_ignored(path, &ignored))
        .collect();
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

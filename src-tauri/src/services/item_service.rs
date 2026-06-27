use crate::models::{Item, ItemWithTags};
use crate::services::file_identity::{self, FileIdentity};
use crate::services::icon_service;
use crate::services::tag_service;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

/// SELECT 查询中使用的列名常量
pub const ITEM_COLS: &str =
    "id, name, path, type, icon_path, created_at, last_used_at, is_favorite, is_missing";

/// 默认排序：收藏优先 → 最近使用 → 名称
pub const ITEM_ORDER: &str = "is_favorite DESC, last_used_at DESC NULLS LAST, name";

/// 从数据库行映射为 Item
pub fn item_from_row(row: &rusqlite::Row) -> rusqlite::Result<Item> {
    let fav: i64 = row.get(7)?;
    let missing: i64 = row.get(8)?;
    Ok(Item {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        item_type: row.get(3)?,
        icon_path: row.get(4)?,
        created_at: row.get(5)?,
        last_used_at: row.get(6)?,
        is_favorite: fav != 0,
        is_missing: missing != 0,
    })
}

/// 解析行中的文件身份（volume_serial + file_id 十六进制）。
fn row_identity(volume_serial: Option<i64>, file_id_hex: Option<String>) -> Option<FileIdentity> {
    let vs = volume_serial?;
    let fid = FileIdentity::parse_file_id_hex(&file_id_hex?)?;
    Some(FileIdentity {
        volume_serial: vs as u32,
        file_id: fid,
    })
}

/// 按 id 取回单个 Item。
fn select_item_by_id(conn: &Connection, id: i64) -> Result<Item, String> {
    let sql = format!("SELECT {} FROM items WHERE id = ?1", ITEM_COLS);
    conn.prepare(&sql)
        .map_err(|e| e.to_string())?
        .query_row([id], item_from_row)
        .map_err(|e| e.to_string())
}

/// 自动检测文件类型
pub fn detect_type(path: &str) -> &'static str {
    const IMAGE_EXTS: &[&str] = &[
        "png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic",
        "heif",
    ];
    const AUDIO_EXTS: &[&str] = &[
        "aac", "ape", "aiff", "aif", "afc", "aifc", "mp3", "mp2", "mp1", "wav", "wave", "wv",
        "opus", "flac", "ogg", "m4a", "m4b", "m4p", "m4r", "mpc", "mp+", "mpp", "spx",
    ];

    let p = Path::new(path);
    if p.is_dir() {
        return "folder";
    }
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some(ext) if IMAGE_EXTS.contains(&ext) => "image",
        Some(ext) if AUDIO_EXTS.contains(&ext) => "audio",
        Some("exe") => "exe",
        Some("bat") | Some("cmd") => "bat",
        Some("ps1") => "ps1",
        _ => "exe",
    }
}

/// 从路径提取文件名
pub fn get_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

/// 添加项目：以文件身份(卷序列号+文件ID)为唯一键去重；取不到身份时回退按 path 去重。
fn add_one(conn: &Connection, path: &str) -> Result<Item, String> {
    let identity = file_identity::get_identity(path);

    if let Some(idn) = identity {
        // 已管理同一文件（即使被改名/移动过）→ 更新到最新位置、清除失效标记后返回
        if let Some(existing_id) = conn
            .query_row(
                "SELECT id FROM items WHERE volume_serial = ?1 AND file_id = ?2",
                params![idn.volume_serial as i64, idn.file_id_hex()],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            conn.execute(
                "UPDATE items SET path = ?1, name = ?2, is_missing = 0 WHERE id = ?3",
                params![path, get_name(path), existing_id],
            )
            .map_err(|e| e.to_string())?;
            return select_item_by_id(conn, existing_id);
        }
    } else if let Some(existing_id) = conn
        .query_row(
            "SELECT id FROM items WHERE path = ?1 AND file_id IS NULL",
            [path],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        // 无文件身份的对象（非 NTFS/网络盘等）按 path 去重；
        // 与有身份分支保持一致：命中已存在记录时清除失效标记并刷新名称，
        // 避免"重新拖入已恢复的对象后仍显示失效"。
        conn.execute(
            "UPDATE items SET name = ?1, is_missing = 0 WHERE id = ?2",
            params![get_name(path), existing_id],
        )
        .map_err(|e| e.to_string())?;
        return select_item_by_id(conn, existing_id);
    }

    let name = get_name(path);
    let item_type = detect_type(path);
    let (vol, fid) = match identity {
        Some(i) => (Some(i.volume_serial as i64), Some(i.file_id_hex())),
        None => (None, None),
    };
    // 顺带记录内容签名（仅文件有效），用于跨盘符移动后的兜底重定位。
    let sig = file_identity::compute_signature(path);
    conn.execute(
        "INSERT INTO items (name, path, type, volume_serial, file_id, sig_size, sig_head, sig_tail) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            name,
            path,
            item_type,
            vol,
            fid,
            sig.map(|s| s.size as i64),
            sig.map(|s| s.head_hash as i64),
            sig.map(|s| s.tail_hash as i64)
        ],
    )
    .map_err(|e| e.to_string())?;

    select_item_by_id(conn, conn.last_insert_rowid())
}

/// 添加项目
pub fn add_item(conn: &Connection, path: &str) -> Result<Item, String> {
    add_one(conn, path)
}

fn add_item_in_tx(tx: &rusqlite::Transaction<'_>, path: &str) -> Result<Item, String> {
    add_one(tx, path)
}

#[derive(Serialize)]
pub struct AddItemsResult {
    pub items: Vec<Item>,
    pub failed: Vec<AddItemFailure>,
}

#[derive(Serialize)]
pub struct AddItemFailure {
    pub path: String,
    pub error: String,
}

/// 批量添加项目（逐条隔离失败，避免单条异常影响整批导入）
pub fn add_items(conn: &mut Connection, paths: Vec<String>) -> AddItemsResult {
    let mut items = Vec::new();
    let mut failed = Vec::new();

    let tx = match conn.transaction() {
        Ok(tx) => tx,
        Err(error) => {
            return AddItemsResult {
                items,
                failed: paths
                    .into_iter()
                    .map(|path| AddItemFailure {
                        path,
                        error: error.to_string(),
                    })
                    .collect(),
            };
        }
    };

    for path in paths {
        if path.trim().is_empty() {
            failed.push(AddItemFailure {
                path,
                error: "路径不能为空".to_string(),
            });
            continue;
        }

        match add_item_in_tx(&tx, &path) {
            Ok(item) => items.push(item),
            Err(error) => failed.push(AddItemFailure { path, error }),
        }
    }

    if let Err(error) = tx.commit() {
        // 整批回滚场景：之前逐项校验失败的（本就非法）保留原始错误，
        // 而原本成功却被回滚的项加上"批量回滚: "前缀，便于前端区分两类失败。
        return AddItemsResult {
            items: Vec::new(),
            failed: failed
                .into_iter()
                .chain(items.into_iter().map(|item| AddItemFailure {
                    path: item.path,
                    error: format!("批量回滚: {}", error),
                }))
                .collect(),
        };
    }

    AddItemsResult { items, failed }
}

/// 批量删除项目（单条 DELETE ... IN (...) 语句，天然原子）。
pub fn remove_items(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("DELETE FROM items WHERE id IN ({})", placeholders);
    let params = ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect::<Vec<_>>();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除项目
pub fn remove_item(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 更新项目缩略图
pub fn update_item_icon(
    conn: &Connection,
    item_id: i64,
    icon_path: Option<String>,
) -> Result<(), String> {
    let normalized = icon_path.and_then(|p| {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let affected = conn
        .execute(
            "UPDATE items SET icon_path = ?1 WHERE id = ?2",
            params![normalized, item_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err(format!("Item {} not found", item_id));
    }
    Ok(())
}

/// 获取所有项目（含标签，不含自动图标）。
/// 自动图标涉及文件系统/PowerShell IO，由调用方在释放 DB 锁后用 fill_visuals 补齐，
/// 避免在持有 DB 锁期间串行执行重 IO 阻塞其它命令。
pub fn get_items(conn: &Connection) -> Result<Vec<ItemWithTags>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let items: Vec<Item> = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    tag_service::items_with_tags(conn, items)
}

/// 在锁外为列表补齐自动可视路径（图标/封面）。
pub fn fill_visuals(app: &AppHandle, items: &mut [ItemWithTags]) {
    for iwt in items.iter_mut() {
        icon_service::fill_item_visual(app, &mut iwt.item);
    }
}

/// 获取单个项目（含标签和自动图标）
pub fn get_item(app: &AppHandle, conn: &Connection, id: i64) -> Result<ItemWithTags, String> {
    let sql = format!("SELECT {} FROM items WHERE id = ?1", ITEM_COLS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut items = vec![
        stmt.query_row([id], item_from_row)
            .map_err(|e| e.to_string())?,
    ];

    icon_service::fill_auto_visual_paths(app, &mut items);
    tag_service::items_with_tags(conn, items)?
        .into_iter()
        .next()
        .ok_or_else(|| format!("Item {} not found", id))
}

/// 批量获取指定项目（含标签和自动图标）
pub fn get_items_by_ids(
    app: &AppHandle,
    conn: &Connection,
    ids: &[i64],
) -> Result<Vec<ItemWithTags>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut unique_ids = ids.to_vec();
    unique_ids.sort_unstable();
    unique_ids.dedup();

    let placeholders = unique_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT {} FROM items WHERE id IN ({}) ORDER BY {}",
        ITEM_COLS, placeholders, ITEM_ORDER,
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params = unique_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect::<Vec<_>>();

    let mut items: Vec<Item> = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    icon_service::fill_auto_visual_paths(app, &mut items);
    tag_service::items_with_tags(conn, items)
}

/// 切换收藏状态
pub fn toggle_favorite(conn: &Connection, id: i64) -> Result<bool, String> {
    conn.execute(
        "UPDATE items SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;

    let new_val: i64 = conn
        .query_row("SELECT is_favorite FROM items WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(new_val != 0)
}

/// 惰性对账：刷新时检测每个对象的文件是否仍在原路径，
/// - 在原路径 → 视为有效；缺身份则回填文件ID；曾失效则清除失效标记。
/// - 不在原路径但有文件ID → 用文件ID重定位（同盘移动/重命名），成功则更新 path/name，失败标记失效。
/// - 不在原路径且无文件ID → 标记失效。
/// 仅断裂的对象才走 FFI 重定位，常规刷新只做一次廉价的 exists() 检查。
pub fn reconcile_items(conn: &Connection) -> Result<(), String> {
    let rows: Vec<(i64, String, Option<i64>, Option<String>, i64, Option<i64>)> = {
        let mut stmt = conn
            .prepare("SELECT id, path, volume_serial, file_id, is_missing, sig_size FROM items")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })
            .map_err(|e| e.to_string())?;
        mapped.filter_map(|r| r.ok()).collect()
    };

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (id, path, vol, fid, is_missing, sig_size) in rows {
        let exists = Path::new(&path).exists();
        let identity = row_identity(vol, fid);

        if exists {
            if identity.is_none() {
                // 回填文件ID。唯一冲突=极少数多条记录指向同一物理文件(硬链接/历史重复)，
                // 记录日志以便排查，不阻断对账（该记录退化为按 path 处理）。
                if let Some(newid) = file_identity::get_identity(&path) {
                    if let Err(e) = tx.execute(
                        "UPDATE items SET volume_serial = ?1, file_id = ?2 WHERE id = ?3",
                        params![newid.volume_serial as i64, newid.file_id_hex(), id],
                    ) {
                        eprintln!("[reconcile] 回填 file_id 失败 (item {}): {}", id, e);
                    }
                }
            }
            // 惰性回填内容签名（仅文件、一次性）：为跨盘兜底重定位准备弱身份。
            if sig_size.is_none() {
                if let Some(sig) = file_identity::compute_signature(&path) {
                    let _ = tx.execute(
                        "UPDATE items SET sig_size = ?1, sig_head = ?2, sig_tail = ?3 WHERE id = ?4",
                        params![sig.size as i64, sig.head_hash as i64, sig.tail_hash as i64, id],
                    );
                }
            }
            if is_missing != 0 {
                let _ = tx.execute("UPDATE items SET is_missing = 0 WHERE id = ?1", [id]);
            }
        } else if let Some(idn) = identity {
            match file_identity::resolve_path(idn, &path) {
                Some(new_path) => {
                    let _ = tx.execute(
                        "UPDATE items SET path = ?1, name = ?2, is_missing = 0 WHERE id = ?3",
                        params![new_path, get_name(&new_path), id],
                    );
                }
                None if is_missing == 0 => {
                    let _ = tx.execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [id]);
                }
                None => {}
            }
        } else if is_missing == 0 {
            let _ = tx.execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [id]);
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 取对象当前真实路径（用于启动 / 打开所在文件夹）：
/// 路径有效直接返回；失效则用文件ID重定位并持久化新路径；彻底找不到则标记失效并返回错误。
pub fn resolve_current_path(conn: &Connection, id: i64) -> Result<String, String> {
    let (path, vol, fid): (String, Option<i64>, Option<String>) = conn
        .query_row(
            "SELECT path, volume_serial, file_id FROM items WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let identity = row_identity(vol, fid);

    // 路径仍存在时：无身份记录直接采信；有身份记录则校验该路径处文件确为同一对象，
    // 防止原文件被删后同位置放入了不同文件，从而启动/打开到错误对象。
    if Path::new(&path).exists() {
        match identity {
            Some(idn) if file_identity::get_identity(&path) != Some(idn) => {
                // 路径已被其它文件占用 → 落到下方按文件ID重定位真正的对象
            }
            _ => return Ok(path),
        }
    }

    if let Some(idn) = identity {
        if let Some(new_path) = file_identity::resolve_path(idn, &path) {
            conn.execute(
                "UPDATE items SET path = ?1, name = ?2, is_missing = 0 WHERE id = ?3",
                params![new_path, get_name(&new_path), id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(new_path);
        }
    }

    let _ = conn.execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [id]);
    Err("对象已丢失，无法定位文件".to_string())
}

// ─────────────────────────────────────────────────────────────────────────
// 跨盘符兜底找回：对失效对象按内容签名在候选盘扫描重定位。
// 扫描在 DB 锁外进行（命令层先取数据释放锁，扫描，再加锁回写），避免长扫描阻塞其它命令。
// ─────────────────────────────────────────────────────────────────────────

/// 待按签名找回的失效对象（已带内容签名）。
pub struct MissingSignatureRow {
    pub id: i64,
    pub size: u64,
    pub head: u64,
    pub tail: u64,
}

/// 读取所有"失效且有内容签名"的对象，供锁外扫描使用。
pub fn read_missing_signatures(conn: &Connection) -> Result<Vec<MissingSignatureRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sig_size, sig_head, sig_tail FROM items \
             WHERE is_missing = 1 AND sig_size IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MissingSignatureRow {
                id: r.get(0)?,
                size: r.get::<_, i64>(1)? as u64,
                head: r.get::<_, i64>(2)? as u64,
                tail: r.get::<_, i64>(3)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 扫描时跳过的系统目录名与遍历上限（异常情况下防止无限扫描）。
const SCAN_SKIP_DIRS: &[&str] = &[
    "$Recycle.Bin",
    "System Volume Information",
    "$WinREAgent",
    "$SysReset",
    "Windows.old",
];
const SCAN_MAX_ENTRIES: usize = 3_000_000;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// 在候选盘内一次遍历，按 (size → 签名) 匹配所有失效对象，返回 (item_id, 新路径)。
/// 不持有 DB 锁。先按文件大小廉价预筛，命中大小再做哈希校验；全部找到即提前结束。
pub fn scan_for_signatures(rows: &[MissingSignatureRow]) -> Vec<(i64, String)> {
    use std::collections::HashMap;
    if rows.is_empty() {
        return Vec::new();
    }
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        by_size.entry(r.size).or_default().push(i);
    }
    let mut resolved = vec![false; rows.len()];
    let mut found: Vec<(i64, String)> = Vec::new();
    let mut budget = SCAN_MAX_ENTRIES;

    for root in file_identity::candidate_roots() {
        if resolved.iter().all(|&x| x) || budget == 0 {
            break;
        }
        scan_dir_tree(&root, &by_size, rows, &mut resolved, &mut found, &mut budget);
    }
    found
}

fn scan_dir_tree(
    root: &str,
    by_size: &std::collections::HashMap<u64, Vec<usize>>,
    rows: &[MissingSignatureRow],
    resolved: &mut [bool],
    found: &mut Vec<(i64, String)>,
    budget: &mut usize,
) {
    use std::os::windows::fs::MetadataExt;
    let mut stack: Vec<std::path::PathBuf> = vec![std::path::PathBuf::from(root)];

    while let Some(dir) = stack.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            if *budget == 0 {
                return;
            }
            *budget -= 1;

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            // 跳过 junction/符号链接，避免遍历成环
            if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                continue;
            }

            if meta.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if SCAN_SKIP_DIRS.iter().any(|s| name.eq_ignore_ascii_case(s)) {
                    continue;
                }
                stack.push(entry.path());
            } else if meta.is_file() {
                let indices = match by_size.get(&meta.len()) {
                    Some(v) => v,
                    None => continue, // 大小不匹配，跳过昂贵的哈希
                };
                let path = entry.path();
                let path_str = path.to_string_lossy().to_string();
                let sig = match file_identity::compute_signature(&path_str) {
                    Some(s) => s,
                    None => continue,
                };
                for &idx in indices {
                    if resolved[idx] {
                        continue;
                    }
                    if rows[idx].head == sig.head_hash && rows[idx].tail == sig.tail_hash {
                        resolved[idx] = true;
                        found.push((rows[idx].id, path_str.clone()));
                    }
                }
                if resolved.iter().all(|&x| x) {
                    return;
                }
            }
        }
    }
}

/// 将扫描命中的新路径回写：重算文件身份与签名、更新位置并清除失效标记。
/// 身份与已有记录冲突（极少数）时跳过该条，返回成功找回数量。
pub fn apply_signature_relocations(
    conn: &Connection,
    found: &[(i64, String)],
) -> Result<usize, String> {
    let mut count = 0usize;
    for (id, new_path) in found {
        let (vol, fid) = match file_identity::get_identity(new_path) {
            Some(i) => (Some(i.volume_serial as i64), Some(i.file_id_hex())),
            None => (None, None),
        };
        let sig = file_identity::compute_signature(new_path);
        match conn.execute(
            "UPDATE items SET path = ?1, name = ?2, volume_serial = ?3, file_id = ?4, \
             sig_size = ?5, sig_head = ?6, sig_tail = ?7, is_missing = 0 WHERE id = ?8",
            params![
                new_path,
                get_name(new_path),
                vol,
                fid,
                sig.map(|s| s.size as i64),
                sig.map(|s| s.head_hash as i64),
                sig.map(|s| s.tail_hash as i64),
                id
            ],
        ) {
            Ok(_) => count += 1,
            Err(e) => eprintln!("[relocate] 回写对象 {} 失败(可能身份冲突): {}", id, e),
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk");
        schema::create_tables(&conn).expect("schema");
        conn
    }

    #[test]
    fn add_item_dedupes_by_path_when_no_file_identity() {
        // 不存在的路径取不到文件ID，走"按 path 去重"分支
        let conn = setup();
        let p = r"D:\__tl_test_nonexistent__\a.exe";
        let a = add_item(&conn, p).expect("add 1");
        let b = add_item(&conn, p).expect("add 2");
        assert_eq!(a.id, b.id, "同一不存在路径应去重为同一条记录");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn remove_items_deletes_all_given_ids_atomically() {
        let conn = setup();
        let a = add_item(&conn, r"D:\__tl_test__\1.exe").unwrap();
        let b = add_item(&conn, r"D:\__tl_test__\2.exe").unwrap();
        let c = add_item(&conn, r"D:\__tl_test__\3.exe").unwrap();
        remove_items(&conn, &[a.id, c.id]).expect("batch remove");
        let remaining: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM items ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert_eq!(remaining, vec![b.id]);
    }

    #[test]
    fn reconcile_marks_missing_for_nonexistent_path_without_identity() {
        let conn = setup();
        let a = add_item(&conn, r"D:\__tl_test_missing__\x.exe").unwrap();
        let before: i64 = conn
            .query_row("SELECT is_missing FROM items WHERE id=?1", [a.id], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 0);
        reconcile_items(&conn).expect("reconcile");
        let after: i64 = conn
            .query_row("SELECT is_missing FROM items WHERE id=?1", [a.id], |r| r.get(0))
            .unwrap();
        assert_eq!(after, 1, "路径不存在且无文件ID应标记失效");
    }

    #[test]
    fn detect_type_supports_audio_without_common_video_containers() {
        assert_eq!(detect_type(r"D:\Music\track.mp3"), "audio");
        assert_eq!(detect_type(r"D:\Music\track.FLAC"), "audio");
        assert_eq!(detect_type(r"D:\Music\track.m4a"), "audio");
        assert_eq!(detect_type(r"D:\Video\clip.mp4"), "exe");
        assert_eq!(detect_type(r"D:\Video\clip.m4v"), "exe");
        assert_eq!(detect_type(r"D:\Music\track.wma"), "exe");
    }

    #[test]
    fn detect_type_keeps_existing_file_types() {
        assert_eq!(detect_type(r"D:\Images\cover.png"), "image");
        assert_eq!(detect_type(r"D:\Apps\tool.exe"), "exe");
        assert_eq!(detect_type(r"D:\Scripts\build.cmd"), "bat");
        assert_eq!(detect_type(r"D:\Scripts\profile.ps1"), "ps1");
    }

    #[test]
    fn scan_dir_tree_finds_relocated_file_by_signature() {
        use std::collections::HashMap;
        let base = std::env::temp_dir().join(format!("tl_relocate_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let target = base.join("sub").join("moved.bin");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        let data: Vec<u8> = (0..50_000u32).map(|i| (i % 97) as u8).collect();
        std::fs::write(&target, &data).unwrap();

        let target_str = target.to_string_lossy().to_string();
        let sig = file_identity::compute_signature(&target_str).expect("sig");
        let rows = vec![MissingSignatureRow {
            id: 42,
            size: sig.size,
            head: sig.head_hash,
            tail: sig.tail_hash,
        }];
        let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
        by_size.insert(sig.size, vec![0usize]);
        let mut resolved = vec![false];
        let mut found = Vec::new();
        let mut budget = 1_000_000usize;

        scan_dir_tree(
            &base.to_string_lossy(),
            &by_size,
            &rows,
            &mut resolved,
            &mut found,
            &mut budget,
        );

        assert_eq!(found.len(), 1, "应按内容签名找回文件");
        assert_eq!(found[0].0, 42);
        assert!(found[0].1.to_lowercase().ends_with("moved.bin"));

        let _ = std::fs::remove_dir_all(&base);
    }
}

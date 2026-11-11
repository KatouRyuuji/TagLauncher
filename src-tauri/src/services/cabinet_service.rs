use crate::models::{Cabinet, Item, ItemWithTags};
use crate::services::item_service::item_from_row;
use crate::services::tag_service;
use rusqlite::{params, Connection};

/// 获取所有文件柜
pub fn get_cabinets(conn: &Connection) -> Result<Vec<Cabinet>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, created_at, folder_path, folder_truncated, sort_order, parent_id
             FROM cabinets ORDER BY sort_order, name",
        )
        .map_err(|e| e.to_string())?;

    let cabinets = stmt
        .query_map([], |row| {
            Ok(Cabinet {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                folder_path: row.get(4)?,
                folder_truncated: row.get(5)?,
                sort_order: row.get(6)?,
                folder_state: None,
                parent_id: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log(
            "get_cabinets",
        ))
        .collect();

    Ok(cabinets)
}

/// 把 SQLite 错误映射为用户可读文案：UNIQUE 冲突（cabinets.name 唯一）转为明确提示，
/// 其余错误保留原始消息。add/update 共用，避免前端拿到 "UNIQUE constraint failed" 原文。
fn friendly_name_err(e: rusqlite::Error) -> String {
    let msg = e.to_string();
    if msg.contains("UNIQUE constraint failed") {
        "已存在同名文件柜，请换一个名称".to_string()
    } else {
        msg
    }
}

/// 新建文件柜
pub fn add_cabinet(conn: &Connection, name: &str, color: &str) -> Result<Cabinet, String> {
    crate::db::ensure_writes_allowed()?;
    // 校验与落库统一使用 trim 后的值（与 tag_service::add_tag 同一口径）
    let name = name.trim();
    if name.is_empty() {
        return Err("文件柜名称不能为空".to_string());
    }
    // 新建排在末尾
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM cabinets",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO cabinets (name, color, sort_order) VALUES (?1, ?2, ?3)",
        params![name, color, sort_order],
    )
    .map_err(friendly_name_err)?;

    let id = conn.last_insert_rowid();
    let created_at: String = conn
        .query_row("SELECT created_at FROM cabinets WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(Cabinet {
        id,
        name: name.to_string(),
        color: color.to_string(),
        created_at,
        folder_path: None,
        folder_truncated: false,
        sort_order,
        folder_state: None,
        parent_id: None,
    })
}

/// 按给定 id 顺序写入文件柜的手动顺序（1 起），单事务；不在列表中的柜不变。
pub fn reorder_cabinets(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    tag_service::write_sort_order(conn, "cabinets", ids)
}

/// 更新文件柜
pub fn update_cabinet(conn: &Connection, id: i64, name: &str, color: &str) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    // 与 add_cabinet 同一口径：trim 后落库，空名拒绝
    let name = name.trim();
    if name.is_empty() {
        return Err("文件柜名称不能为空".to_string());
    }
    let affected = conn
        .execute(
            "UPDATE cabinets SET name = ?1, color = ?2 WHERE id = ?3",
            params![name, color, id],
        )
        .map_err(friendly_name_err)?;
    // 与 update_item_icon 同一口径：id 不存在时明确报错，不静默成功
    if affected == 0 {
        return Err(format!("文件柜不存在（id {}），可能已被删除", id));
    }
    Ok(())
}

/// 删除文件柜：子柜上移一级（挂到被删柜的父柜，顶层柜的子柜成为顶层），不级联删除子柜与其成员。
pub fn remove_cabinet(conn: &Connection, id: i64) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    let tx = crate::db::write_tx(&conn).map_err(|e| e.to_string())?;
    let parent: Option<i64> = tx
        .query_row("SELECT parent_id FROM cabinets WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("文件柜不存在（id {}），可能已被删除", id),
            other => other.to_string(),
        })?;
    tx.execute(
        "UPDATE cabinets SET parent_id = ?2 WHERE parent_id = ?1",
        params![id, parent],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM cabinets WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ 嵌套（F16 方案 C）

/// 以 `id` 为根的子树（含自身），广度优先。`UNION` 去重：即使库里被外部写出环也不会死循环。
pub fn subtree_ids(conn: &Connection, id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE sub(id) AS (
                 SELECT ?1
                 UNION
                 SELECT c.id FROM cabinets c JOIN sub ON c.parent_id = sub.id
             )
             SELECT id FROM sub",
        )
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map([id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

fn has_children(conn: &Connection, id: i64) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cabinets WHERE parent_id = ?1)",
        [id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// 设置父柜（None = 移到顶层）。拒绝：自身为父、父为自己的子孙（成环）、父是关联文件夹柜（只能是叶子）。
pub fn set_cabinet_parent(conn: &Connection, id: i64, parent: Option<i64>) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    tag_service::ensure_exists(conn, "cabinets", id, "文件柜")?;
    if let Some(parent) = parent {
        tag_service::ensure_exists(conn, "cabinets", parent, "父文件柜")?;
        if parent == id {
            return Err("不能把文件柜放进它自己".to_string());
        }
        if linked_folder(conn, parent)?.is_some() {
            return Err("关联文件夹的文件柜只能在最底层，不能再放入子柜".to_string());
        }
        if subtree_ids(conn, id)?.contains(&parent) {
            return Err("不能把文件柜放进它自己的子柜".to_string());
        }
    }
    conn.execute(
        "UPDATE cabinets SET parent_id = ?2 WHERE id = ?1",
        params![id, parent],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 添加项目到文件柜
pub fn add_item_to_cabinet(conn: &Connection, cabinet_id: i64, item_id: i64) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    // 先校验存在性给友好文案：否则把裸 FOREIGN KEY constraint failed 抛给前端
    // （与 tag_service::set_item_tags 同一模式）
    tag_service::ensure_exists(conn, "cabinets", cabinet_id, "文件柜")?;
    ensure_not_linked(conn, cabinet_id)?;
    tag_service::ensure_exists(conn, "items", item_id, "对象")?;
    conn.execute(
        "INSERT OR IGNORE INTO cabinet_items (cabinet_id, item_id) VALUES (?1, ?2)",
        params![cabinet_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从文件柜移除项目
pub fn remove_item_from_cabinet(
    conn: &Connection,
    cabinet_id: i64,
    item_id: i64,
) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    ensure_not_linked(conn, cabinet_id)?;
    conn.execute(
        "DELETE FROM cabinet_items WHERE cabinet_id = ?1 AND item_id = ?2",
        params![cabinet_id, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量将项目加入文件柜（整批一个事务，幂等）。
pub fn add_items_to_cabinet(
    conn: &Connection,
    cabinet_id: i64,
    item_ids: &[i64],
) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    let tx = crate::db::write_tx(&conn).map_err(|e| e.to_string())?;
    // 先校验存在性给友好文案（事务保证校验失败时不留半份写入）
    tag_service::ensure_exists(&tx, "cabinets", cabinet_id, "文件柜")?;
    ensure_not_linked(&tx, cabinet_id)?;
    tag_service::ensure_ids_exist(&tx, "items", item_ids, "对象")?;
    {
        let mut insert = tx
            .prepare("INSERT OR IGNORE INTO cabinet_items (cabinet_id, item_id) VALUES (?1, ?2)")
            .map_err(|e| e.to_string())?;
        for item_id in item_ids {
            insert
                .execute(params![cabinet_id, *item_id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量从文件柜移除（按 IN_CHUNK 分块、整批一个事务，原子）。
/// 单条 IN (...) 在成员数超过 SQLite 变量上限（旧版 999）时会直接失败。
pub fn remove_items_from_cabinet(
    conn: &Connection,
    cabinet_id: i64,
    item_ids: &[i64],
) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    ensure_not_linked(conn, cabinet_id)?;
    if item_ids.is_empty() {
        return Ok(());
    }
    let tx = crate::db::write_tx(&conn).map_err(|e| e.to_string())?;
    for chunk in item_ids.chunks(crate::services::item_service::IN_CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "DELETE FROM cabinet_items WHERE cabinet_id = ? AND item_id IN ({})",
            placeholders
        );
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&cabinet_id];
        for id in chunk {
            params.push(id);
        }
        tx.execute(&sql, params.as_slice())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 各文件柜成员计数，与父柜默认视图同一口径：自身 ∪ 全部子孙柜（去重）。
/// 无子柜的柜走原来的轻量计数（普通柜一次 GROUP BY，关联柜各一次路径前缀计数）；
/// 只有带子柜的柜才取成员 ID 做并集。供侧栏徽标使用，不做对账与图标补齐。
pub fn get_cabinet_item_counts(conn: &Connection) -> Result<Vec<(i64, i64)>, String> {
    let mut counts = own_item_counts(conn)?;
    let parents: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT parent_id FROM cabinets WHERE parent_id IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    if parents.is_empty() {
        return Ok(counts);
    }
    let mut own: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    for parent in parents {
        let mut union = std::collections::HashSet::new();
        for cab in subtree_ids(conn, parent)? {
            if !own.contains_key(&cab) {
                let ids = own_member_ids(conn, cab)?.0;
                own.insert(cab, ids);
            }
            union.extend(own[&cab].iter().copied());
        }
        let n = union.len() as i64;
        match counts.iter_mut().find(|(id, _)| *id == parent) {
            Some(entry) => entry.1 = n,
            None => counts.push((parent, n)),
        }
    }
    Ok(counts)
}

/// 仅本柜成员计数（不含子柜）。
fn own_item_counts(conn: &Connection) -> Result<Vec<(i64, i64)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT ci.cabinet_id, COUNT(*) FROM cabinet_items ci
             JOIN cabinets c ON c.id = ci.cabinet_id
             WHERE c.folder_path IS NULL
             GROUP BY ci.cabinet_id",
        )
        .map_err(|e| e.to_string())?;
    let mut counts: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log(
            "get_cabinet_item_counts",
        ))
        .collect();
    for (cabinet_id, folder) in bound_folders(conn)? {
        let count: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM items WHERE {UNDER_FOLDER}"),
                [like_pattern(&folder)],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        counts.push((cabinet_id, count));
    }
    Ok(counts)
}

/// 获取文件柜内的所有项目：关联柜按路径取文件夹下的全部对象，普通柜取 cabinet_items 成员；
/// `include_descendants` 时并入全部子孙柜成员（去重，保持同一排序）。
pub fn get_cabinet_items(
    conn: &Connection,
    cabinet_id: i64,
    include_descendants: bool,
) -> Result<Vec<ItemWithTags>, String> {
    if include_descendants && has_children(conn, cabinet_id)? {
        let (ids, _) = cabinet_member_ids(conn, cabinet_id, true)?;
        let mut items = crate::services::item_service::get_items_by_ids(conn, &ids)?;
        // 与单柜查询同一 ORDER：收藏优先、最近使用、名称
        items.sort_by(|a, b| {
            b.item.is_favorite
                .cmp(&a.item.is_favorite)
                .then_with(|| match (&a.item.last_used_at, &b.item.last_used_at) {
                    (Some(x), Some(y)) => y.cmp(x),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                })
                .then_with(|| a.item.name.cmp(&b.item.name))
        });
        return Ok(items);
    }
    own_cabinet_items(conn, cabinet_id)
}

fn own_cabinet_items(conn: &Connection, cabinet_id: i64) -> Result<Vec<ItemWithTags>, String> {
    const COLUMNS: &str = crate::services::item_service::ITEM_COLS_I;
    const ORDER: &str = "ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name";
    let items: Vec<Item> = match linked_folder(conn, cabinet_id)? {
        Some(folder) => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {COLUMNS} FROM items i WHERE {} {ORDER}",
                    UNDER_FOLDER.replace("path", "i.path")
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([like_pattern(&folder)], item_from_row)
                .map_err(|e| e.to_string())?
                .filter_map(crate::services::item_service::skip_err_with_log(
                    "get_cabinet_items",
                ))
                .collect();
            rows
        }
        None => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {COLUMNS} FROM items i
                     INNER JOIN cabinet_items ci ON i.id = ci.item_id
                     WHERE ci.cabinet_id = ?1 {ORDER}"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([cabinet_id], item_from_row)
                .map_err(|e| e.to_string())?
                .filter_map(crate::services::item_service::skip_err_with_log(
                    "get_cabinet_items",
                ))
                .collect();
            rows
        }
    };

    // 图标在锁外由调用方 fill_visuals 补齐（见 cabinet_commands::get_cabinet_items）
    tag_service::items_with_tags(conn, items)
}

/// 「路径位于关联文件夹之下」的条件（不含文件夹本身）；参数为 like_pattern 的结果。
/// 分隔符统一为 `\`；LIKE 对 ASCII 不区分大小写，与 Windows 路径语义一致。
const UNDER_FOLDER: &str = "replace(path, '/', '\\') LIKE ?1 ESCAPE '^'";

/// 规范化关联文件夹路径：去首尾空白、分隔符统一为 `\`、去掉末尾分隔符（盘符根保留为 `D:\`）。
pub fn normalize_folder(folder: &str) -> String {
    let unified = folder.trim().replace('/', "\\");
    let trimmed = unified.trim_end_matches('\\');
    if trimmed.len() == 2 && trimmed.ends_with(':') {
        format!("{trimmed}\\")
    } else {
        trimmed.to_string()
    }
}

/// 关联文件夹的前缀（规范化后带末尾 `\`），用于判断路径是否位于其下。
pub fn folder_prefix(folder: &str) -> String {
    let normalized = normalize_folder(folder);
    if normalized.ends_with('\\') {
        normalized
    } else {
        format!("{normalized}\\")
    }
}

/// 路径是否位于前缀（folder_prefix 的结果）之下，不区分大小写。
pub fn path_under(path: &str, prefix: &str) -> bool {
    path.replace('/', "\\")
        .to_lowercase()
        .starts_with(&prefix.to_lowercase())
}

fn like_pattern(folder: &str) -> String {
    let mut pattern = String::new();
    for ch in folder_prefix(folder).chars() {
        if matches!(ch, '%' | '_' | '^') {
            pattern.push('^');
        }
        pattern.push(ch);
    }
    pattern.push('%');
    pattern
}

/// 柜成员 ID（与 get_cabinet_items 同一成员口径）与关联文件夹。主窗视图查询用，不取对象数据。
/// `include_descendants`：并入全部子孙柜成员（父柜默认视图）；关联文件夹只返回本柜自己的
/// （关联柜只能是叶子，并集视图不按磁盘目录浏览）。
pub fn cabinet_member_ids(
    conn: &Connection,
    cabinet_id: i64,
    include_descendants: bool,
) -> Result<(Vec<i64>, Option<String>), String> {
    let (own, folder) = own_member_ids(conn, cabinet_id)?;
    if !include_descendants || !has_children(conn, cabinet_id)? {
        return Ok((own, folder));
    }
    let mut seen: std::collections::HashSet<i64> = own.iter().copied().collect();
    let mut ids = own;
    for cab in subtree_ids(conn, cabinet_id)? {
        if cab == cabinet_id {
            continue;
        }
        for id in own_member_ids(conn, cab)?.0 {
            if seen.insert(id) {
                ids.push(id);
            }
        }
    }
    Ok((ids, folder))
}

fn own_member_ids(
    conn: &Connection,
    cabinet_id: i64,
) -> Result<(Vec<i64>, Option<String>), String> {
    let folder = linked_folder(conn, cabinet_id)?;
    let ids = match &folder {
        Some(f) => {
            let mut stmt = conn
                .prepare(&format!("SELECT id FROM items WHERE {UNDER_FOLDER}"))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([like_pattern(f)], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
        None => {
            let mut stmt = conn
                .prepare("SELECT item_id FROM cabinet_items WHERE cabinet_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([cabinet_id], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
    };
    Ok((ids, folder))
}

fn linked_folder(conn: &Connection, cabinet_id: i64) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT folder_path FROM cabinets WHERE id = ?1",
        [cabinet_id],
        |r| r.get(0),
    )
    .or_else(|e| match e {
        // 柜不存在按普通柜处理（成员为空），存在性由需要的调用方另行校验
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn ensure_not_linked(conn: &Connection, cabinet_id: i64) -> Result<(), String> {
    match linked_folder(conn, cabinet_id) {
        Ok(Some(_)) => Err("关联文件夹的文件柜内容由文件夹决定".to_string()),
        _ => Ok(()),
    }
}

/// 所有关联柜的 (id, 文件夹)。
pub fn bound_folders(conn: &Connection) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT id, folder_path FROM cabinets WHERE folder_path IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<(i64, String)>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 关联文件夹状态（访问磁盘，须在锁外调用）："ok" 可用；"offline" 所在盘不可用；
/// "missing" 盘在而文件夹不在。
pub fn folder_state(folder: &str) -> &'static str {
    let path = std::path::Path::new(folder);
    if path.is_dir() {
        "ok"
    } else if path.ancestors().last().is_some_and(|root| root.exists()) {
        "missing"
    } else {
        "offline"
    }
}

/// 所在盘离线的关联文件夹前缀：对账跳过其下对象，盘恢复后自动重新核对。
pub fn offline_folder_prefixes(bound: &[(i64, String)]) -> Vec<String> {
    bound
        .iter()
        .filter(|(_, folder)| folder_state(folder) == "offline")
        .map(|(_, folder)| folder_prefix(folder))
        .collect()
}

/// 关联或解除文件夹（单事务）。
/// 关联：文件夹须存在；清空该柜手动成员，成员改由路径决定；同一文件夹只能关联一个柜。
/// 解除（folder 为 None）：把当前路径成员固化进 cabinet_items，柜恢复为普通柜；磁盘不受影响。
pub fn set_cabinet_folder(
    conn: &Connection,
    cabinet_id: i64,
    folder: Option<&str>,
) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    tag_service::ensure_exists(conn, "cabinets", cabinet_id, "文件柜")?;
    let current = linked_folder(conn, cabinet_id)?;
    let tx = crate::db::write_tx(&conn).map_err(|e| e.to_string())?;
    match folder {
        Some(folder) => {
            if has_children(conn, cabinet_id)? {
                return Err("该文件柜包含子柜；关联文件夹的文件柜只能在最底层，请先移走子柜".to_string());
            }
            let normalized = normalize_folder(folder);
            if normalized.is_empty() || !std::path::Path::new(&normalized).is_dir() {
                return Err(format!("文件夹不存在或不可访问：{}", folder.trim()));
            }
            tx.execute(
                "DELETE FROM cabinet_items WHERE cabinet_id = ?1",
                [cabinet_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE cabinets SET folder_path = ?2, folder_truncated = 0 WHERE id = ?1",
                params![cabinet_id, normalized],
            )
            .map_err(|e| {
                if e.to_string().contains("UNIQUE constraint failed") {
                    "该文件夹已关联到其他文件柜".to_string()
                } else {
                    e.to_string()
                }
            })?;
        }
        None => {
            let Some(current) = current else {
                return Ok(());
            };
            tx.execute(
                &format!(
                    "INSERT OR IGNORE INTO cabinet_items (cabinet_id, item_id)
                     SELECT ?2, id FROM items WHERE {UNDER_FOLDER}"
                ),
                params![like_pattern(&current), cabinet_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE cabinets SET folder_path = NULL, folder_truncated = 0 WHERE id = ?1",
                [cabinet_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::services::item_service;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk");
        schema::create_tables(&conn).expect("schema");
        conn
    }

    #[test]
    fn duplicate_cabinet_name_returns_friendly_error() {
        let conn = setup();
        add_cabinet(&conn, "Games", "#fff").expect("first add");
        let err = add_cabinet(&conn, "Games", "#000").expect_err("duplicate should fail");
        assert_eq!(
            err, "已存在同名文件柜，请换一个名称",
            "UNIQUE 冲突应映射为友好文案"
        );
    }

    #[test]
    fn batch_add_and_remove_cabinet_items() {
        let conn = setup();
        let cab = add_cabinet(&conn, "Games", "#fff").expect("add cabinet");
        let a = item_service::add_item(&conn, r"D:\__c__\1.exe").unwrap();
        let b = item_service::add_item(&conn, r"D:\__c__\2.exe").unwrap();
        let c = item_service::add_item(&conn, r"D:\__c__\3.exe").unwrap();

        add_items_to_cabinet(&conn, cab.id, &[a.id, b.id, c.id]).expect("batch add");
        // 幂等：重复加入不产生重复记录
        add_items_to_cabinet(&conn, cab.id, &[a.id]).expect("idempotent add");
        assert_eq!(get_cabinet_items(&conn, cab.id, true).unwrap().len(), 3);

        remove_items_from_cabinet(&conn, cab.id, &[a.id, c.id]).expect("batch remove");
        let left = get_cabinet_items(&conn, cab.id, true).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].item.id, b.id);
    }

    #[test]
    fn cabinet_item_counts_group_by_cabinet() {
        let conn = setup();
        let cab_a = add_cabinet(&conn, "Games", "#fff").expect("add cabinet a");
        let cab_b = add_cabinet(&conn, "Tools", "#000").expect("add cabinet b");
        let x = item_service::add_item(&conn, r"D:\__c__\1.exe").unwrap();
        let y = item_service::add_item(&conn, r"D:\__c__\2.exe").unwrap();

        add_items_to_cabinet(&conn, cab_a.id, &[x.id, y.id]).expect("batch add a");
        add_items_to_cabinet(&conn, cab_b.id, &[y.id]).expect("batch add b");

        let counts: std::collections::HashMap<i64, i64> = get_cabinet_item_counts(&conn)
            .unwrap()
            .into_iter()
            .collect();
        assert_eq!(counts.get(&cab_a.id), Some(&2));
        assert_eq!(counts.get(&cab_b.id), Some(&1));
    }

    #[test]
    fn folder_paths_normalize_and_match_case_insensitively() {
        assert_eq!(normalize_folder(r" D:/Media\Shows\ "), r"D:\Media\Shows");
        assert_eq!(normalize_folder("D:/"), r"D:\");
        assert_eq!(folder_prefix("D:"), r"D:\");
        assert_eq!(like_pattern(r"D:\a_b%c^"), r"D:\a^_b^%c^^\%");
        assert!(path_under(
            "d:/media/shows/x.mkv",
            &folder_prefix(r"D:\Media")
        ));
        assert!(!path_under(r"D:\Media", &folder_prefix(r"D:\Media")));
        assert!(!path_under(r"D:\MediaX\y", &folder_prefix(r"D:\Media")));
    }

    fn parent_of(conn: &Connection, id: i64) -> Option<i64> {
        conn.query_row("SELECT parent_id FROM cabinets WHERE id = ?1", [id], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn nested_parent_rejects_self_cycle_and_linked_parent() {
        let conn = setup();
        let a = add_cabinet(&conn, "A", "#fff").unwrap();
        let b = add_cabinet(&conn, "B", "#fff").unwrap();
        let c = add_cabinet(&conn, "C", "#fff").unwrap();
        set_cabinet_parent(&conn, b.id, Some(a.id)).unwrap();
        set_cabinet_parent(&conn, c.id, Some(b.id)).unwrap();
        assert_eq!(subtree_ids(&conn, a.id).unwrap(), vec![a.id, b.id, c.id]);

        assert!(set_cabinet_parent(&conn, a.id, Some(a.id)).is_err(), "不能以自己为父");
        let err = set_cabinet_parent(&conn, a.id, Some(c.id)).unwrap_err();
        assert!(err.contains("子柜"), "防环：{err}");
        assert_eq!(parent_of(&conn, a.id), None, "拒绝后不落库");
        assert!(set_cabinet_parent(&conn, a.id, Some(999)).is_err(), "父柜须存在");

        // 关联文件夹柜只能是叶子：不能做父，也不能给有子柜的柜关联文件夹
        let dir = std::env::temp_dir();
        let leaf = add_cabinet(&conn, "Linked", "#fff").unwrap();
        set_cabinet_folder(&conn, leaf.id, Some(dir.to_str().unwrap())).unwrap();
        let err = set_cabinet_parent(&conn, c.id, Some(leaf.id)).unwrap_err();
        assert!(err.contains("最底层"), "{err}");
        set_cabinet_parent(&conn, leaf.id, Some(a.id)).expect("关联柜可以作为子柜");
        let err = set_cabinet_folder(&conn, b.id, Some(dir.to_str().unwrap())).unwrap_err();
        assert!(err.contains("子柜"), "{err}");

        set_cabinet_parent(&conn, c.id, None).unwrap();
        assert_eq!(parent_of(&conn, c.id), None, "移到顶层");
    }

    #[test]
    fn subtree_query_terminates_on_externally_written_cycle() {
        let conn = setup();
        let a = add_cabinet(&conn, "A", "#fff").unwrap();
        let b = add_cabinet(&conn, "B", "#fff").unwrap();
        conn.execute("UPDATE cabinets SET parent_id = ?2 WHERE id = ?1", params![a.id, b.id]).unwrap();
        conn.execute("UPDATE cabinets SET parent_id = ?2 WHERE id = ?1", params![b.id, a.id]).unwrap();
        let mut ids = subtree_ids(&conn, a.id).unwrap();
        ids.sort();
        assert_eq!(ids, vec![a.id, b.id]);
        let (members, _) = cabinet_member_ids(&conn, a.id, true).unwrap();
        assert!(members.is_empty());
    }

    #[test]
    fn parent_view_unions_descendants_and_only_self_excludes_them() {
        let conn = setup();
        let root = add_cabinet(&conn, "Root", "#fff").unwrap();
        let child = add_cabinet(&conn, "Child", "#fff").unwrap();
        let grand = add_cabinet(&conn, "Grand", "#fff").unwrap();
        set_cabinet_parent(&conn, child.id, Some(root.id)).unwrap();
        set_cabinet_parent(&conn, grand.id, Some(child.id)).unwrap();
        let x = item_service::add_item(&conn, r"D:\__n__\x.exe").unwrap();
        let y = item_service::add_item(&conn, r"D:\__n__\y.exe").unwrap();
        let z = item_service::add_item(&conn, r"D:\__n__\z.exe").unwrap();
        add_items_to_cabinet(&conn, root.id, &[x.id]).unwrap();
        add_items_to_cabinet(&conn, child.id, &[x.id, y.id]).unwrap();
        add_items_to_cabinet(&conn, grand.id, &[z.id]).unwrap();

        let mut all = cabinet_member_ids(&conn, root.id, true).unwrap().0;
        all.sort();
        assert_eq!(all, vec![x.id, y.id, z.id], "自身 ∪ 子孙，去重");
        assert_eq!(cabinet_member_ids(&conn, root.id, false).unwrap().0, vec![x.id], "仅本柜");
        assert_eq!(get_cabinet_items(&conn, root.id, true).unwrap().len(), 3);
        assert_eq!(get_cabinet_items(&conn, root.id, false).unwrap().len(), 1);
        // 成员不继承写入：父柜的 cabinet_items 没有被写入子柜成员
        let own: i64 = conn
            .query_row("SELECT COUNT(*) FROM cabinet_items WHERE cabinet_id = ?1", [root.id], |r| r.get(0))
            .unwrap();
        assert_eq!(own, 1);

        let counts: std::collections::HashMap<i64, i64> =
            get_cabinet_item_counts(&conn).unwrap().into_iter().collect();
        assert_eq!(counts.get(&root.id), Some(&3), "父柜计数与默认视图一致（去重并集）");
        assert_eq!(counts.get(&child.id), Some(&3));
        assert_eq!(counts.get(&grand.id), Some(&1));

        let snapshot = item_service::read_cabinet_reconcile_snapshot(&conn, root.id).unwrap();
        assert_eq!(snapshot.len(), 3, "切到父柜时核对整个子树");
    }

    #[test]
    fn removing_parent_moves_children_up_one_level_and_keeps_members() {
        let conn = setup();
        let top = add_cabinet(&conn, "Top", "#fff").unwrap();
        let mid = add_cabinet(&conn, "Mid", "#fff").unwrap();
        let leaf = add_cabinet(&conn, "Leaf", "#fff").unwrap();
        set_cabinet_parent(&conn, mid.id, Some(top.id)).unwrap();
        set_cabinet_parent(&conn, leaf.id, Some(mid.id)).unwrap();
        let x = item_service::add_item(&conn, r"D:\__r__\x.exe").unwrap();
        add_items_to_cabinet(&conn, leaf.id, &[x.id]).unwrap();

        remove_cabinet(&conn, mid.id).unwrap();
        assert_eq!(parent_of(&conn, leaf.id), Some(top.id), "子柜上移一级");
        assert_eq!(get_cabinet_items(&conn, leaf.id, false).unwrap().len(), 1, "子柜成员保留");
        remove_cabinet(&conn, top.id).unwrap();
        assert_eq!(parent_of(&conn, leaf.id), None, "顶层柜删除后子柜成为顶层");
        assert!(remove_cabinet(&conn, 999).is_err());
    }
}

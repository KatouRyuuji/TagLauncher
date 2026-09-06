use crate::models::{Cabinet, Item, ItemWithTags};
use crate::services::item_service::item_from_row;
use crate::services::tag_service;
use rusqlite::{params, Connection};

/// 获取所有文件柜
pub fn get_cabinets(conn: &Connection) -> Result<Vec<Cabinet>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at FROM cabinets ORDER BY name")
        .map_err(|e| e.to_string())?;

    let cabinets = stmt
        .query_map([], |row| {
            Ok(Cabinet {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log("get_cabinets"))
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
    if name.trim().is_empty() {
        return Err("文件柜名称不能为空".to_string());
    }
    conn.execute(
        "INSERT INTO cabinets (name, color) VALUES (?1, ?2)",
        params![name, color],
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
    })
}

/// 更新文件柜
pub fn update_cabinet(conn: &Connection, id: i64, name: &str, color: &str) -> Result<(), String> {
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

/// 删除文件柜
pub fn remove_cabinet(conn: &Connection, id: i64) -> Result<(), String> {
    let affected = conn
        .execute("DELETE FROM cabinets WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("文件柜不存在（id {}），可能已被删除", id));
    }
    Ok(())
}

/// 添加项目到文件柜
pub fn add_item_to_cabinet(conn: &Connection, cabinet_id: i64, item_id: i64) -> Result<(), String> {
    // 先校验存在性给友好文案：否则把裸 FOREIGN KEY constraint failed 抛给前端
    // （与 tag_service::set_item_tags 同一模式）
    tag_service::ensure_exists(conn, "cabinets", cabinet_id, "文件柜")?;
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
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // 先校验存在性给友好文案（事务保证校验失败时不留半份写入）
    tag_service::ensure_exists(&tx, "cabinets", cabinet_id, "文件柜")?;
    for item_id in item_ids {
        tag_service::ensure_exists(&tx, "items", *item_id, "对象")?;
        tx.execute(
            "INSERT OR IGNORE INTO cabinet_items (cabinet_id, item_id) VALUES (?1, ?2)",
            params![cabinet_id, *item_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量从文件柜移除（按 500 分块、整批一个事务，原子）。
/// 单条 IN (...) 在成员数超过 SQLite 变量上限（旧版 999）时会直接失败。
pub fn remove_items_from_cabinet(
    conn: &Connection,
    cabinet_id: i64,
    item_ids: &[i64],
) -> Result<(), String> {
    if item_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for chunk in item_ids.chunks(500) {
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

/// 各文件柜成员计数（一次 GROUP BY 查询，供侧栏徽标使用，
/// 避免逐柜调用 get_cabinet_items 引发的全库对账 + 图标补齐重 IO）
pub fn get_cabinet_item_counts(conn: &Connection) -> Result<Vec<(i64, i64)>, String> {
    let mut stmt = conn
        .prepare("SELECT cabinet_id, COUNT(*) FROM cabinet_items GROUP BY cabinet_id")
        .map_err(|e| e.to_string())?;
    let counts = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log("get_cabinet_item_counts"))
        .collect();
    Ok(counts)
}

/// 获取文件柜内的所有项目
pub fn get_cabinet_items(
    conn: &Connection,
    cabinet_id: i64,
) -> Result<Vec<ItemWithTags>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite, i.is_missing
             FROM items i
             INNER JOIN cabinet_items ci ON i.id = ci.item_id
             WHERE ci.cabinet_id = ?1
             ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        )
        .map_err(|e| e.to_string())?;

    let items: Vec<Item> = stmt
        .query_map([cabinet_id], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log("get_cabinet_items"))
        .collect();

    // 图标在锁外由调用方 fill_visuals 补齐（见 cabinet_commands::get_cabinet_items）
    tag_service::items_with_tags(conn, items)
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
        assert_eq!(err, "已存在同名文件柜，请换一个名称", "UNIQUE 冲突应映射为友好文案");
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
        assert_eq!(get_cabinet_items(&conn, cab.id).unwrap().len(), 3);

        remove_items_from_cabinet(&conn, cab.id, &[a.id, c.id]).expect("batch remove");
        let left = get_cabinet_items(&conn, cab.id).unwrap();
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

        let counts: std::collections::HashMap<i64, i64> =
            get_cabinet_item_counts(&conn).unwrap().into_iter().collect();
        assert_eq!(counts.get(&cab_a.id), Some(&2));
        assert_eq!(counts.get(&cab_b.id), Some(&1));
    }
}

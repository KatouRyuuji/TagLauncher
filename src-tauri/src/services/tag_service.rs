use crate::models::{Item, ItemWithTags, Tag};
use rusqlite::{params, Connection};

/// 查询指定项目关联的所有标签
pub fn get_item_tags(conn: &Connection, item_id: i64) -> Result<Vec<Tag>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color FROM tags t
             INNER JOIN item_tags it ON t.id = it.tag_id
             WHERE it.item_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([item_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tags = Vec::new();
    for row in rows {
        tags.push(row.map_err(|e| e.to_string())?);
    }
    Ok(tags)
}

/// 批量为项目列表附加标签信息
pub fn items_with_tags(conn: &Connection, items: Vec<Item>) -> Result<Vec<ItemWithTags>, String> {
    let mut result = Vec::with_capacity(items.len());
    for item in items {
        let tags = get_item_tags(conn, item.id)?;
        result.push(ItemWithTags { item, tags });
    }
    Ok(result)
}

/// 获取所有标签
pub fn get_tags(conn: &Connection) -> Result<Vec<Tag>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, color FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// 新建标签
pub fn add_tag(conn: &Connection, name: &str, color: &str) -> Result<Tag, String> {
    conn.execute(
        "INSERT INTO tags (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(Tag {
        id,
        name: name.to_string(),
        color: color.to_string(),
    })
}

/// 更新标签
pub fn update_tag(conn: &Connection, id: i64, name: &str, color: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除标签
pub fn remove_tag(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 设置项目的标签列表（全量替换）
pub fn set_item_tags(conn: &Connection, item_id: i64, tag_ids: &[i64]) -> Result<(), String> {
    conn.execute("DELETE FROM item_tags WHERE item_id = ?1", [item_id])
        .map_err(|e| e.to_string())?;

    for tag_id in tag_ids {
        conn.execute(
            "INSERT INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, *tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

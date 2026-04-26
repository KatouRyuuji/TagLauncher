use crate::models::{Item, ItemWithTags, Tag};
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// 查询指定项目关联的所有标签
#[cfg(test)]
pub fn get_item_tags(conn: &Connection, item_id: i64) -> Result<Vec<Tag>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color FROM tags t
             INNER JOIN item_tags it ON t.id = it.tag_id
             WHERE it.item_id = ?1
             ORDER BY it.position, t.name",
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
    if items.is_empty() {
        return Ok(Vec::new());
    }

    let item_ids = items.iter().map(|item| item.id).collect::<Vec<_>>();
    let tags_by_item = get_tags_for_items(conn, &item_ids)?;

    let mut result = Vec::with_capacity(items.len());
    for item in items {
        let tags = tags_by_item.get(&item.id).cloned().unwrap_or_default();
        result.push(ItemWithTags { item, tags });
    }
    Ok(result)
}

fn get_tags_for_items(
    conn: &Connection,
    item_ids: &[i64],
) -> Result<HashMap<i64, Vec<Tag>>, String> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut tags_by_item: HashMap<i64, Vec<Tag>> = HashMap::new();

    for chunk in item_ids.chunks(500) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT it.item_id, t.id, t.name, t.color
             FROM item_tags it
             INNER JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id IN ({})
             ORDER BY it.item_id, it.position, t.name",
            placeholders,
        );
        let params = chunk
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    Tag {
                        id: row.get(1)?,
                        name: row.get(2)?,
                        color: row.get(3)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (item_id, tag) = row.map_err(|e| e.to_string())?;
            tags_by_item.entry(item_id).or_default().push(tag);
        }
    }

    Ok(tags_by_item)
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

    for (position, tag_id) in tag_ids.iter().enumerate() {
        conn.execute(
            "INSERT INTO item_tags (item_id, tag_id, position) VALUES (?1, ?2, ?3)",
            params![item_id, *tag_id, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::{params, Connection};

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("enable foreign keys");
        schema::create_tables(&conn).expect("create tables");
        conn
    }

    #[test]
    fn item_tags_keep_saved_order() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES ('Item', 'D:\\Item.exe', 'exe')",
            [],
        )
        .expect("insert item");
        let item_id = conn.last_insert_rowid();

        for name in ["Alpha", "Beta", "Gamma"] {
            conn.execute(
                "INSERT INTO tags (name, color) VALUES (?1, '#fff')",
                params![name],
            )
            .expect("insert tag");
        }

        let tags = get_tags(&conn).expect("get tags");
        let alpha_id = tags.iter().find(|tag| tag.name == "Alpha").expect("alpha").id;
        let beta_id = tags.iter().find(|tag| tag.name == "Beta").expect("beta").id;
        let gamma_id = tags.iter().find(|tag| tag.name == "Gamma").expect("gamma").id;

        set_item_tags(&conn, item_id, &[gamma_id, alpha_id, beta_id]).expect("set tags");
        let item_tags = get_item_tags(&conn, item_id).expect("get item tags");
        let names: Vec<&str> = item_tags.iter().map(|tag| tag.name.as_str()).collect();

        assert_eq!(names, vec!["Gamma", "Alpha", "Beta"]);
    }
}

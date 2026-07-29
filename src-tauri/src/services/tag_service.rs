use crate::models::{Item, ItemWithTags, Tag};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

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

/// 全量替换单个对象标签的核心逻辑（不含事务，供 set_item_tags 与 set_many_item_tags 复用）。
fn set_item_tags_core(conn: &Connection, item_id: i64, tag_ids: &[i64]) -> Result<(), String> {
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

/// 设置项目的标签列表（全量替换）
pub fn set_item_tags(conn: &Connection, item_id: i64, tag_ids: &[i64]) -> Result<(), String> {
    // 用事务把 DELETE + 全部 INSERT 包成原子操作：中途任一失败整体回滚，
    // 避免出现"删光旧标签但只写入部分新标签"导致对象标签丢失的情况。
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    set_item_tags_core(&tx, item_id, tag_ids)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 批量设置多个对象的标签（整批一个事务，原子）。
pub fn set_many_item_tags(conn: &Connection, changes: &[(i64, Vec<i64>)]) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (item_id, tag_ids) in changes {
        set_item_tags_core(&tx, *item_id, tag_ids)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// 标签层级关系（DAG，多继承）
//
// 标签是集合，父标签是子标签的超集；一个标签可有多个父标签。
// 选中某标签筛选时，并入其所有后代标签的对象（见 expand_with_descendants）。
// 关系图必须无环，环的预防在 add_tag_relation 完成。
// ─────────────────────────────────────────────────────────────────────────

/// 获取所有父子关系边 (parent_id, child_id)。
pub fn get_tag_relations(conn: &Connection) -> Result<Vec<(i64, i64)>, String> {
    let mut stmt = conn
        .prepare("SELECT parent_id, child_id FROM tag_relations")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 某标签的所有后代集合（沿 child 边闭包，含传入节点自身）。
/// 用递归 CTE 一次查询完成（与 expand_with_descendants 一致），UNION 天然去重并终止潜在环。
fn descendants_of(conn: &Connection, id: i64) -> Result<HashSet<i64>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE descendants(id) AS (
                SELECT ?1
                UNION
                SELECT tr.child_id FROM tag_relations tr JOIN descendants d ON tr.parent_id = d.id
             )
             SELECT id FROM descendants",
        )
        .map_err(|e| e.to_string())?;
    let seen = stmt
        .query_map([id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(seen)
}

/// 新增父子关系：禁止自环；禁止形成环（parent 已是 child 的后代时拒绝）；重复添加幂等。
pub fn add_tag_relation(conn: &Connection, parent_id: i64, child_id: i64) -> Result<(), String> {
    if parent_id == child_id {
        return Err("标签不能成为自己的父级".to_string());
    }
    // 若 parent 已在 child 的后代集合中，新增 parent→child 会成环。
    if descendants_of(conn, child_id)?.contains(&parent_id) {
        return Err("该关系会形成循环（父标签已是子标签的后代）".to_string());
    }
    conn.execute(
        "INSERT OR IGNORE INTO tag_relations (parent_id, child_id) VALUES (?1, ?2)",
        params![parent_id, child_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除父子关系。
pub fn remove_tag_relation(conn: &Connection, parent_id: i64, child_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tag_relations WHERE parent_id = ?1 AND child_id = ?2",
        params![parent_id, child_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 把给定标签集合展开为「自身 + 所有后代」（递归闭包）。用于按父标签筛选时并入后代对象。
pub fn expand_with_descendants(conn: &Connection, ids: &[i64]) -> Result<Vec<i64>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let seed = ids.iter().map(|_| "SELECT ?").collect::<Vec<_>>().join(" UNION ");
    // UNION（去重）天然终止潜在环；正常情况下 DAG 无环。
    let sql = format!(
        "WITH RECURSIVE descendants(id) AS (
            {seed}
            UNION
            SELECT tr.child_id FROM tag_relations tr JOIN descendants d ON tr.parent_id = d.id
         )
         SELECT id FROM descendants"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let out = stmt
        .query_map(params.as_slice(), |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(out)
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

    #[test]
    fn set_many_item_tags_applies_all_changes_atomically() {
        let conn = setup_conn();
        for name in ["I1", "I2"] {
            conn.execute(
                "INSERT INTO items (name, path, type) VALUES (?1, ?1, 'exe')",
                params![name],
            )
            .unwrap();
        }
        let i1: i64 = conn.query_row("SELECT id FROM items WHERE name='I1'", [], |r| r.get(0)).unwrap();
        let i2: i64 = conn.query_row("SELECT id FROM items WHERE name='I2'", [], |r| r.get(0)).unwrap();
        for name in ["T1", "T2"] {
            conn.execute("INSERT INTO tags (name, color) VALUES (?1, '#fff')", params![name]).unwrap();
        }
        let t1: i64 = conn.query_row("SELECT id FROM tags WHERE name='T1'", [], |r| r.get(0)).unwrap();
        let t2: i64 = conn.query_row("SELECT id FROM tags WHERE name='T2'", [], |r| r.get(0)).unwrap();

        set_many_item_tags(&conn, &[(i1, vec![t1, t2]), (i2, vec![t2])]).expect("set many");

        assert_eq!(get_item_tags(&conn, i1).unwrap().len(), 2);
        let i2_tags = get_item_tags(&conn, i2).unwrap();
        assert_eq!(i2_tags.len(), 1);
        assert_eq!(i2_tags[0].name, "T2");
    }

    fn tag_id(conn: &Connection, name: &str) -> i64 {
        conn.query_row("SELECT id FROM tags WHERE name=?1", params![name], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn tag_relations_expand_and_prevent_cycles() {
        let conn = setup_conn();
        for n in ["a", "b", "c"] {
            conn.execute("INSERT INTO tags (name,color) VALUES (?1,'#fff')", params![n]).unwrap();
        }
        let (a, b, c) = (tag_id(&conn, "a"), tag_id(&conn, "b"), tag_id(&conn, "c"));

        add_tag_relation(&conn, a, b).expect("a->b");
        add_tag_relation(&conn, b, c).expect("b->c");

        // a 的后代闭包 = {a,b,c}
        let mut exp = expand_with_descendants(&conn, &[a]).unwrap();
        exp.sort();
        let mut want = vec![a, b, c];
        want.sort();
        assert_eq!(exp, want);

        // 环检测：c->a 会成环（a 已是 c 的祖先），自环也拒绝
        assert!(add_tag_relation(&conn, c, a).is_err(), "应拒绝成环关系");
        assert!(add_tag_relation(&conn, a, a).is_err(), "应拒绝自环");

        // 多继承：a->c 直接边（c 同时是 b 与 a 的子），仍无环
        add_tag_relation(&conn, a, c).expect("a->c multi-parent");

        // 删除 a->b 后，b 不再是 a 的后代
        remove_tag_relation(&conn, a, b).unwrap();
        let mut exp2 = expand_with_descendants(&conn, &[a]).unwrap();
        exp2.sort();
        let mut want2 = vec![a, c];
        want2.sort();
        assert_eq!(exp2, want2);
    }

    #[test]
    fn deleting_tag_cascades_relations() {
        let conn = setup_conn();
        for n in ["p", "ch"] {
            conn.execute("INSERT INTO tags (name,color) VALUES (?1,'#fff')", params![n]).unwrap();
        }
        let (p, ch) = (tag_id(&conn, "p"), tag_id(&conn, "ch"));
        add_tag_relation(&conn, p, ch).unwrap();
        assert_eq!(get_tag_relations(&conn).unwrap().len(), 1);

        remove_tag(&conn, p).unwrap();
        assert!(
            get_tag_relations(&conn).unwrap().is_empty(),
            "删除标签应级联删除其关系边"
        );
    }
}

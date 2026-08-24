use crate::models::{Item, ItemWithTags};
use crate::services::item_service::{item_from_row, ITEM_COLS, ITEM_ORDER};
use crate::services::tag_service;
use rusqlite::Connection;

/// 搜索项目（支持文本 + 标签组合查询）。不含自动图标：
/// 图标涉及重 IO，由调用方在释放 DB 锁后用 item_service::fill_visuals 补齐。
pub fn search_items(
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<ItemWithTags>, String> {
    let items: Vec<Item> = if query.is_empty() && tag_ids.is_empty() {
        query_all_items(conn)?
    } else if !query.is_empty() && tag_ids.is_empty() {
        query_items_by_text(conn, query)?
    } else if query.is_empty() && !tag_ids.is_empty() {
        query_items_by_tags(conn, tag_ids)?
    } else {
        query_items_by_text_and_tags(conn, query, tag_ids)?
    };

    tag_service::items_with_tags(conn, items)
}

fn query_all_items(conn: &Connection) -> Result<Vec<Item>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log("query_all_items"))
        .collect();
    Ok(items)
}

fn query_items_by_text(conn: &Connection, query: &str) -> Result<Vec<Item>, String> {
    let search_query = format_fts_query(query);
    if search_query.is_empty() {
        return query_items_by_text_like(conn, query);
    }

    let sql = "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite, i.is_missing
         FROM items i
         INNER JOIN items_fts ON i.id = items_fts.rowid
         WHERE items_fts MATCH ?1
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name";
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    // query_map 返回的是惰性迭代器，FTS 的 MATCH 运行期错误要在迭代取行时才会暴露，
    // 不能用 filter_map(|r| r.ok()) 吞掉（会把运行期错误变成空结果而不触发 LIKE 回退）。
    // 先整体 collect 成 Result，Err 时回退到 LIKE 路径。
    let rows: Result<Vec<Item>, rusqlite::Error> = match stmt.query_map([search_query], item_from_row)
    {
        Ok(rows) => rows.collect(),
        Err(_) => return query_items_by_text_like(conn, query),
    };
    match rows {
        Ok(items) => Ok(items),
        Err(_) => query_items_by_text_like(conn, query),
    }
}

fn query_items_by_text_like(conn: &Connection, query: &str) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let sql = format!(
        "SELECT {} FROM items WHERE name LIKE ?1 OR path LIKE ?1 ORDER BY {}",
        ITEM_COLS, ITEM_ORDER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([search_query], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log("query_items_by_text_like"))
        .collect();
    Ok(items)
}

/// 为每个选中标签构建「对象拥有该标签或其任一后代」的 EXISTS 子句；
/// 多个选中标签之间为 AND（交集语义，但每个选中项并入其后代）。
/// 返回 (合并后的 WHERE 片段, 顺序参数)。
fn tag_group_clauses(conn: &Connection, tag_ids: &[i64]) -> Result<(String, Vec<i64>), String> {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<i64> = Vec::new();
    for &tid in tag_ids {
        // expand 至少含自身，不会为空
        let expanded = tag_service::expand_with_descendants(conn, &[tid])?;
        let ph = expanded.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        clauses.push(format!(
            "EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id IN ({}))",
            ph
        ));
        params.extend(expanded);
    }
    Ok((clauses.join(" AND "), params))
}

fn query_items_by_tags(conn: &Connection, tag_ids: &[i64]) -> Result<Vec<Item>, String> {
    let (clause, group_params) = tag_group_clauses(conn, tag_ids)?;
    let sql = format!(
        "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite, i.is_missing
         FROM items i
         WHERE {}
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        clause
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = group_params
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log("query_items_by_tags"))
        .collect();
    Ok(items)
}

fn query_items_by_text_and_tags(
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<Item>, String> {
    let search_query = format_fts_query(query);
    if search_query.is_empty() {
        return query_items_by_text_and_tags_like(conn, query, tag_ids);
    }

    let (clause, group_params) = tag_group_clauses(conn, tag_ids)?;
    let sql = format!(
        "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite, i.is_missing
         FROM items i
         INNER JOIN items_fts ON i.id = items_fts.rowid
         WHERE items_fts MATCH ?1
         AND {}
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        clause
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut params_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(search_query)];
    for id in group_params {
        params_values.push(Box::new(id));
    }
    let params: Vec<&dyn rusqlite::ToSql> = params_values.iter().map(|p| p.as_ref()).collect();

    // 同上：先整体 collect，MATCH 运行期错误才能被捕获并回退到 LIKE 路径。
    let rows: Result<Vec<Item>, rusqlite::Error> =
        match stmt.query_map(params.as_slice(), item_from_row) {
            Ok(rows) => rows.collect(),
            Err(_) => return query_items_by_text_and_tags_like(conn, query, tag_ids),
        };
    match rows {
        Ok(items) => Ok(items),
        Err(_) => query_items_by_text_and_tags_like(conn, query, tag_ids),
    }
}

fn query_items_by_text_and_tags_like(
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let (clause, group_params) = tag_group_clauses(conn, tag_ids)?;
    let sql = format!(
        "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite, i.is_missing
         FROM items i
         WHERE (i.name LIKE ?1 OR i.path LIKE ?1)
         AND {}
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        clause
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut params_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(search_query)];
    for id in group_params {
        params_values.push(Box::new(id));
    }
    let params: Vec<&dyn rusqlite::ToSql> = params_values.iter().map(|p| p.as_ref()).collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(crate::services::item_service::skip_err_with_log(
            "query_items_by_text_and_tags_like",
        ))
        .collect();
    Ok(items)
}

fn format_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|part| {
            let escaped = part.replace('"', "\"\"");
            format!("\"{}\"*", escaped)
        })
        .collect::<Vec<_>>()
        .join(" ")
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

    fn insert_item(conn: &Connection, name: &str, path: &str) -> i64 {
        conn.execute(
            "INSERT INTO items (name, path, type) VALUES (?1, ?2, 'exe')",
            params![name, path],
        )
        .expect("insert item");
        conn.last_insert_rowid()
    }

    #[test]
    fn fts_search_handles_windows_path_symbols() {
        let conn = setup_conn();
        insert_item(&conn, "foo-bar.exe", r#"D:\Game Lib\foo-bar.exe"#);

        let items = query_items_by_text(&conn, r#"D:\Game Lib\foo-bar.exe"#)
            .expect("search should not fail on path symbols");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "foo-bar.exe");
    }

    #[test]
    fn fts_search_handles_chinese_text() {
        let conn = setup_conn();
        insert_item(&conn, "测试工具", r#"D:\工具\测试工具.exe"#);

        let items = query_items_by_text(&conn, "测试").expect("search chinese text");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "测试工具");
    }

    #[test]
    fn empty_query_returns_all_items() {
        let conn = setup_conn();
        insert_item(&conn, "Alpha", r#"D:\Alpha.exe"#);
        insert_item(&conn, "Beta", r#"D:\Beta.exe"#);

        let items = query_all_items(&conn).expect("query all items");

        assert_eq!(items.len(), 2);
    }

    #[test]
    fn text_and_tags_falls_back_for_special_symbols() {
        let conn = setup_conn();
        let item_id = insert_item(&conn, "foo(bar).exe", r#"D:\foo(bar).exe"#);
        conn.execute("INSERT INTO tags (name, color) VALUES ('工具', '#fff')", [])
            .expect("insert tag");
        let tag_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, tag_id],
        )
        .expect("link tag");

        let items = query_items_by_text_and_tags(&conn, "foo(bar)", &[tag_id])
            .expect("search text and tags");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "foo(bar).exe");
    }

    #[test]
    fn tag_filters_use_and_semantics() {
        let conn = setup_conn();
        let alpha_id = insert_item(&conn, "Alpha", r#"D:\Alpha.exe"#);
        let beta_id = insert_item(&conn, "Beta", r#"D:\Beta.exe"#);

        conn.execute("INSERT INTO tags (name, color) VALUES ('工具', '#fff')", [])
            .expect("insert tag");
        let tool_tag_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO tags (name, color) VALUES ('游戏', '#fff')", [])
            .expect("insert tag");
        let game_tag_id = conn.last_insert_rowid();

        for (item_id, tag_id) in [
            (alpha_id, tool_tag_id),
            (alpha_id, game_tag_id),
            (beta_id, tool_tag_id),
        ] {
            conn.execute(
                "INSERT INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
                params![item_id, tag_id],
            )
            .expect("link tag");
        }

        let items = query_items_by_tags(&conn, &[tool_tag_id, game_tag_id])
            .expect("query items by tags");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Alpha");
    }

    #[test]
    fn selecting_parent_tag_includes_child_tagged_items() {
        let conn = setup_conn();
        let game = insert_item(&conn, "GameA", r"D:\GameA.exe");
        let _tool = insert_item(&conn, "ToolB", r"D:\ToolB.exe");

        // 标签层级：娱乐(父) → 游戏(子)
        conn.execute("INSERT INTO tags (name,color) VALUES ('娱乐','#fff')", [])
            .unwrap();
        let ent = conn.last_insert_rowid();
        conn.execute("INSERT INTO tags (name,color) VALUES ('游戏','#fff')", [])
            .unwrap();
        let g = conn.last_insert_rowid();
        crate::services::tag_service::add_tag_relation(&conn, ent, g).unwrap();

        // GameA 仅打"游戏"标签
        conn.execute(
            "INSERT INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![game, g],
        )
        .unwrap();

        // 选父标签"娱乐"应并入子标签"游戏"的对象 GameA（集合包含语义）
        let items = query_items_by_tags(&conn, &[ent]).expect("by parent tag");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "GameA");
    }
}

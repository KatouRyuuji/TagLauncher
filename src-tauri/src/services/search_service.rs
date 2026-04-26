use crate::models::{Item, ItemWithTags};
use crate::services::icon_service;
use crate::services::item_service::{item_from_row, ITEM_COLS, ITEM_ORDER};
use crate::services::tag_service;
use rusqlite::Connection;
use tauri::AppHandle;

/// 搜索项目（支持文本 + 标签组合查询）
pub fn search_items(
    app: &AppHandle,
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<ItemWithTags>, String> {
    let mut items: Vec<Item> = if query.is_empty() && tag_ids.is_empty() {
        query_all_items(conn)?
    } else if !query.is_empty() && tag_ids.is_empty() {
        query_items_by_text(conn, query)?
    } else if query.is_empty() && !tag_ids.is_empty() {
        query_items_by_tags(conn, tag_ids)?
    } else {
        query_items_by_text_and_tags(conn, query, tag_ids)?
    };

    icon_service::fill_auto_visual_paths(app, &mut items);
    tag_service::items_with_tags(conn, items)
}

fn query_all_items(conn: &Connection) -> Result<Vec<Item>, String> {
    let sql = format!("SELECT {} FROM items ORDER BY {}", ITEM_COLS, ITEM_ORDER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

fn query_items_by_text(conn: &Connection, query: &str) -> Result<Vec<Item>, String> {
    let search_query = format_fts_query(query);
    if search_query.is_empty() {
        return query_items_by_text_like(conn, query);
    }

    let sql = "SELECT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN items_fts ON i.id = items_fts.rowid
         WHERE items_fts MATCH ?1
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name";
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = match stmt
        .query_map([search_query], item_from_row)
    {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => return query_items_by_text_like(conn, query),
    };
    Ok(items)
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
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

fn query_items_by_tags(conn: &Connection, tag_ids: &[i64]) -> Result<Vec<Item>, String> {
    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE it.tag_id IN ({})
         GROUP BY i.id
         HAVING COUNT(DISTINCT it.tag_id) = {}
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(","),
        tag_ids.len()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = tag_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
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

    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN items_fts ON i.id = items_fts.rowid
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE items_fts MATCH ?1
         AND it.tag_id IN ({})
         GROUP BY i.id
         HAVING COUNT(DISTINCT it.tag_id) = {}
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(","),
        tag_ids.len()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut params_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(search_query)];
    for id in tag_ids {
        params_values.push(Box::new(*id));
    }
    let params: Vec<&dyn rusqlite::ToSql> = params_values.iter().map(|p| p.as_ref()).collect();

    let items = match stmt.query_map(params.as_slice(), item_from_row) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => return query_items_by_text_and_tags_like(conn, query, tag_ids),
    };
    Ok(items)
}

fn query_items_by_text_and_tags_like(
    conn: &Connection,
    query: &str,
    tag_ids: &[i64],
) -> Result<Vec<Item>, String> {
    let search_query = format!("%{}%", query);
    let placeholders: Vec<String> = tag_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT DISTINCT i.id, i.name, i.path, i.type, i.icon_path, i.created_at, i.last_used_at, i.is_favorite
         FROM items i
         INNER JOIN item_tags it ON i.id = it.item_id
         WHERE (i.name LIKE ?1 OR i.path LIKE ?1)
         AND it.tag_id IN ({})
         GROUP BY i.id
         HAVING COUNT(DISTINCT it.tag_id) = {}
         ORDER BY i.is_favorite DESC, i.last_used_at DESC NULLS LAST, i.name",
        placeholders.join(","),
        tag_ids.len()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut params_values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(search_query)];
    for id in tag_ids {
        params_values.push(Box::new(*id));
    }
    let params: Vec<&dyn rusqlite::ToSql> = params_values.iter().map(|p| p.as_ref()).collect();

    let items = stmt
        .query_map(params.as_slice(), item_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
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
}

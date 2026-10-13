use super::Migration;
use rusqlite::Connection;

/// 为对象表增加 text 类型，并把已有文本文件从 exe 重新归类。
///
/// 表重建以库内现有的 items 建表语句为准，只在类型约束里加入 'text'，
/// 列、索引与触发器原样保留。
pub struct V020TextType;

impl Migration for V020TextType {
    fn version(&self) -> u32 {
        20
    }

    fn description(&self) -> &str {
        "Add text item type"
    }

    // 可能重建 items 表，标为破坏性：由 run_pending 在事务外做备份并关闭外键强制。
    fn is_breaking(&self) -> bool {
        true
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        let table_sql = object_sql(conn, "table", "items")?;
        if !table_sql.contains("'text'") {
            rebuild_items_with_text_type(conn, &table_sql)?;
        }
        conn.execute_batch(&text_reclassify_sql())
    }
}

/// 只改判当前为 exe 的对象：文件夹与其他已识别类型不受影响。
fn text_reclassify_sql() -> String {
    let preds = crate::services::item_service::TEXT_EXTS
        .iter()
        .map(|ext| format!("lower(path) GLOB '*.{ext}'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!("UPDATE items SET type = 'text' WHERE type = 'exe' AND ({preds});")
}

fn object_sql(conn: &Connection, kind: &str, name: &str) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2",
        [kind, name],
        |r| r.get(0),
    )
}

// 在 run_pending 提供的事务内执行，外键强制已由框架在事务外关闭。
fn rebuild_items_with_text_type(conn: &Connection, table_sql: &str) -> Result<(), rusqlite::Error> {
    let Some(pos) = table_sql.find("'ps1'") else {
        return Err(rusqlite::Error::InvalidQuery);
    };
    let new_sql = format!(
        "{}'ps1', 'text'{}",
        &table_sql[..pos],
        &table_sql[pos + "'ps1'".len()..]
    );
    let Some(name_pos) = new_sql.find("items") else {
        return Err(rusqlite::Error::InvalidQuery);
    };
    let create_new = format!(
        "{}items_new{}",
        &new_sql[..name_pos],
        &new_sql[name_pos + "items".len()..]
    );

    // DROP TABLE 会连带删除 items 上的索引与触发器，先记下原语句以便重建
    let mut stmt = conn.prepare(
        "SELECT sql FROM sqlite_master
         WHERE tbl_name = 'items' AND type IN ('index', 'trigger') AND sql IS NOT NULL",
    )?;
    let dependents: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    conn.execute_batch(&format!(
        "{create_new};
         INSERT INTO items_new SELECT * FROM items;
         DROP TABLE items;
         ALTER TABLE items_new RENAME TO items;"
    ))?;
    for sql in dependents {
        conn.execute_batch(&sql)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).expect("count")
    }

    /// 老库（约束缺 text）：重建后列、索引、触发器与全文索引保留，文本文件改判，其余不动。
    #[test]
    fn rebuild_adds_text_and_reclassifies_only_exe_files() {
        let conn = Connection::open_in_memory().expect("open");
        let old_schema = r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                type TEXT CHECK(type IN ('folder', 'image', 'audio', 'video', 'exe', 'bat', 'ps1')),
                note TEXT,
                file_id TEXT
            );
            CREATE INDEX idx_items_path ON items(path);
            CREATE VIRTUAL TABLE items_fts USING fts5(name, path, content=items, content_rowid=id);
            CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
                INSERT INTO items_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
            END;
        "#;
        conn.execute_batch(old_schema).expect("old schema");
        conn.execute_batch(
            r#"
            INSERT INTO items (name, path, type, note, file_id) VALUES ('readme', 'D:\Docs\README.MD', 'exe', 'n', 'f1');
            INSERT INTO items (name, path, type) VALUES ('cfgdir', 'D:\Conf\app.json', 'folder');
            INSERT INTO items (name, path, type) VALUES ('tool', 'D:\Tools\tool.exe', 'exe');
            INSERT INTO items (name, path, type) VALUES ('doc', 'D:\Docs\a.docx', 'exe');
            "#,
        )
        .expect("seed");

        V020TextType.up(&conn).expect("migrate");

        let types: Vec<(String, String)> = conn
            .prepare("SELECT name, type FROM items ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            types,
            [
                ("readme".into(), "text".into()),
                ("cfgdir".into(), "folder".into()),
                ("tool".into(), "exe".into()),
                ("doc".into(), "exe".into()),
            ]
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM items WHERE note = 'n' AND file_id = 'f1'"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_items_path', 'items_ai')"), 2);

        // 触发器仍维护全文索引，新约束接受 text
        conn.execute("INSERT INTO items (name, path, type) VALUES ('log', 'D:\\a.log', 'text')", [])
            .expect("insert text");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'log'"), 1);

        // 重复执行无副作用
        V020TextType.up(&conn).expect("rerun");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM items"), 5);
    }

    /// 新库建表语句已含 text：不重建，只做归类。
    #[test]
    fn fresh_schema_accepts_text_without_rebuild() {
        let conn = Connection::open_in_memory().expect("open");
        schema::create_tables(&conn).expect("create");
        assert!(object_sql(&conn, "table", "items").unwrap().contains("'text'"));
        V020TextType.up(&conn).expect("migrate");
        conn.execute("INSERT INTO items (name, path, type) VALUES ('a', 'D:\\a.txt', 'text')", [])
            .expect("insert text");
    }
}

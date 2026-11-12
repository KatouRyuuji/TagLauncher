use super::Migration;
use rusqlite::Connection;

/// 回填监视根与关联柜之下已入库对象的 hide_from_all。
///
/// v021 只加列、旧行默认 0，且监视/关联柜入库此前未传 hide_from_all_paths，
/// 这些夹内文件会铺满「全部」总览。本迁移按当前配置的监视根与关联柜路径补打标记。
///
/// 规则：路径位于 `watch_roots` 对应文件夹对象之下，或位于关联柜 `folder_path` 之下
/// 的项设为 1；根文件夹对象本身不改。已是 1 的行不改写。已关闭的监视根仍回填
/// （文件是当初监视进来的）。未列入监视、也未关联到柜的文件夹下的手动项保持 0。
///
/// 路径匹配与关联柜成员同一口径：`/` 与 `\` 等价，LIKE 对 ASCII 不区分大小写，
/// 前缀带末尾 `\`，因此 `D:\foo` 不会误中 `D:\foobar`。
///
/// 副作用：若用户曾把某文件作为散文件加入库，后来又监视了它的父目录或把该目录
/// 关联到文件柜，回填也会把它藏出总览。对象仍在库中，打开「显示目录内文件」、
/// 搜索、打标或柜视图仍可见。无法按「是否由监视写入」精确区分，这是有意的权衡。
pub struct V024HideFromAllWatch;

/// 「路径位于根之下」且不含根自身；参数为 like_pattern 的结果。
const UNDER_FOLDER: &str = "replace(path, '/', '\\') LIKE ?1 ESCAPE '^'";

/// 与 cabinet_service 的路径前缀 / LIKE 口径保持一致（避免迁移依赖服务层形成模块环）。
fn like_pattern(folder: &str) -> String {
    let unified = folder.trim().replace('/', "\\");
    let trimmed = unified.trim_end_matches('\\');
    let prefix = if trimmed.len() == 2 && trimmed.ends_with(':') {
        format!("{trimmed}\\")
    } else if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\\")
    };
    let mut pattern = String::new();
    for ch in prefix.chars() {
        if matches!(ch, '%' | '_' | '^') {
            pattern.push('^');
        }
        pattern.push(ch);
    }
    pattern.push('%');
    pattern
}

fn backfill(conn: &Connection) -> Result<usize, rusqlite::Error> {
    let mut roots = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT i.path FROM watch_roots w
             JOIN items i ON i.id = w.item_id
             WHERE i.type = 'folder'",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            roots.push(row?);
        }
    }
    {
        let mut stmt =
            conn.prepare("SELECT folder_path FROM cabinets WHERE folder_path IS NOT NULL")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            roots.push(row?);
        }
    }

    let mut updated = 0usize;
    for root in roots {
        let n = conn.execute(
            &format!(
                "UPDATE items SET hide_from_all = 1 WHERE hide_from_all = 0 AND {UNDER_FOLDER}"
            ),
            [like_pattern(&root)],
        )?;
        updated += n;
    }
    Ok(updated)
}

impl Migration for V024HideFromAllWatch {
    fn version(&self) -> u32 {
        24
    }

    fn description(&self) -> &str {
        "Backfill hide_from_all for items under watch roots and linked cabinet folders"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        backfill(conn).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                type TEXT,
                hide_from_all INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE watch_roots (
                item_id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE cabinets (
                id INTEGER PRIMARY KEY,
                name TEXT,
                folder_path TEXT
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn hidden(conn: &Connection, name: &str) -> i64 {
        conn.query_row(
            "SELECT hide_from_all FROM items WHERE name = ?1",
            [name],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn backfills_under_watch_root_and_linked_cabinet_but_not_the_roots() {
        let conn = setup();
        conn.execute_batch(
            r#"
            INSERT INTO items (id, name, path, type, hide_from_all) VALUES
              (1, 'Lib', 'D:\Lib', 'folder', 0),
              (2, 'notes.txt', 'D:\Lib\notes.txt', 'text', 0),
              (3, 'Sub', 'D:\Lib\Sub', 'folder', 0),
              (4, 'deep.txt', 'D:\Lib\Sub\deep.txt', 'text', 0),
              (5, 'Shelf', 'D:\Shelf', 'folder', 0),
              (6, 'a.txt', 'D:/Shelf/a.txt', 'text', 0),
              (7, 'loose.exe', 'D:\loose.exe', 'exe', 0),
              (8, 'Other', 'D:\Other', 'folder', 0),
              (9, 'manual.txt', 'D:\Other\manual.txt', 'text', 0);
            INSERT INTO watch_roots (item_id, enabled) VALUES (1, 1);
            INSERT INTO cabinets (id, name, folder_path) VALUES (1, 'Shelf', 'D:\Shelf');
            "#,
        )
        .unwrap();

        V024HideFromAllWatch.up(&conn).unwrap();
        V024HideFromAllWatch.up(&conn).unwrap();

        assert_eq!(hidden(&conn, "Lib"), 0, "监视根文件夹保持可见");
        assert_eq!(hidden(&conn, "notes.txt"), 1);
        assert_eq!(hidden(&conn, "Sub"), 1);
        assert_eq!(hidden(&conn, "deep.txt"), 1);
        assert_eq!(hidden(&conn, "Shelf"), 0, "关联柜根若已在库中保持可见");
        assert_eq!(hidden(&conn, "a.txt"), 1, "正斜杠路径也应回填");
        assert_eq!(hidden(&conn, "loose.exe"), 0, "根外散文件不回填");
        assert_eq!(hidden(&conn, "Other"), 0);
        assert_eq!(hidden(&conn, "manual.txt"), 0, "未监视文件夹下的手动项不回填");
    }

    #[test]
    fn prefix_is_case_insensitive_and_does_not_match_sibling_names() {
        let conn = setup();
        conn.execute_batch(
            r#"
            INSERT INTO items (id, name, path, type, hide_from_all) VALUES
              (1, 'foo', 'D:\foo', 'folder', 0),
              (2, 'child.txt', 'd:\FOO\child.txt', 'text', 0),
              (3, 'foobar', 'D:\foobar', 'folder', 0),
              (4, 'sibling.txt', 'D:\foobar\x.txt', 'text', 0);
            INSERT INTO watch_roots (item_id, enabled) VALUES (1, 0);
            "#,
        )
        .unwrap();

        assert_eq!(backfill(&conn).unwrap(), 1);
        assert_eq!(hidden(&conn, "foo"), 0);
        assert_eq!(hidden(&conn, "child.txt"), 1, "关闭的监视根仍回填；大小写与分隔符等价");
        assert_eq!(hidden(&conn, "foobar"), 0, "D:\\foo 不得匹配 D:\\foobar");
        assert_eq!(hidden(&conn, "sibling.txt"), 0);
    }

    #[test]
    fn does_not_overwrite_already_hidden_or_touch_unrelated_rows() {
        let conn = setup();
        conn.execute_batch(
            r#"
            INSERT INTO items (id, name, path, type, hide_from_all) VALUES
              (1, 'Lib', 'D:\Lib', 'folder', 0),
              (2, 'old.txt', 'D:\Lib\old.txt', 'text', 1),
              (3, 'new.txt', 'D:\Lib\new.txt', 'text', 0);
            INSERT INTO watch_roots (item_id, enabled) VALUES (1, 1);
            "#,
        )
        .unwrap();
        assert_eq!(backfill(&conn).unwrap(), 1);
        assert_eq!(hidden(&conn, "old.txt"), 1);
        assert_eq!(hidden(&conn, "new.txt"), 1);
        assert_eq!(hidden(&conn, "Lib"), 0);
    }
}

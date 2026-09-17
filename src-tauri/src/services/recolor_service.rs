use rusqlite::{params, Connection};

/// 色位写回补丁：只改 color，不碰 name。
pub struct RecolorPatch<'a> {
    pub id: i64,
    pub color: &'a str,
}

/// `#` + 6 位十六进制，与前端 `^#[0-9a-fA-F]{6}$` 一致。
pub fn is_hex6_color(color: &str) -> bool {
    let bytes = color.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..].iter().all(|c| c.is_ascii_hexdigit())
}

fn reject_bad_hex(color: &str) -> Result<(), String> {
    if is_hex6_color(color) {
        Ok(())
    } else {
        Err(format!("颜色格式无效（须为 #RRGGBB）：{color}"))
    }
}

/// 单事务批量改写标签与文件柜的 color。任一非法 hex / 缺失 id 则整事务拒绝。
pub fn recolor_tags_and_cabinets(
    conn: &Connection,
    tags: &[RecolorPatch<'_>],
    cabinets: &[RecolorPatch<'_>],
) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    for patch in tags.iter().chain(cabinets.iter()) {
        reject_bad_hex(patch.color)?;
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut tag_stmt = tx
            .prepare("UPDATE tags SET color = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for patch in tags {
            let affected = tag_stmt
                .execute(params![patch.color, patch.id])
                .map_err(|e| e.to_string())?;
            if affected == 0 {
                return Err(format!("标签不存在（id {}），可能已被删除", patch.id));
            }
        }
        let mut cabinet_stmt = tx
            .prepare("UPDATE cabinets SET color = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for patch in cabinets {
            let affected = cabinet_stmt
                .execute(params![patch.color, patch.id])
                .map_err(|e| e.to_string())?;
            if affected == 0 {
                return Err(format!("文件柜不存在（id {}），可能已被删除", patch.id));
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("fk");
        schema::create_tables(&conn).expect("schema");
        conn
    }

    #[test]
    fn hex6_accepts_only_hash_rrggbb() {
        assert!(is_hex6_color("#3b82f6"));
        assert!(is_hex6_color("#ABCDEF"));
        assert!(!is_hex6_color("#fff"));
        assert!(!is_hex6_color("3b82f6"));
        assert!(!is_hex6_color("#3b82f6ff"));
        assert!(!is_hex6_color("red"));
    }

    #[test]
    fn unit_batch_writes_colors() {
        let conn = setup();
        conn.execute("INSERT INTO tags (name, color) VALUES ('A', '#111111')", [])
            .unwrap();
        let tag_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO cabinets (name, color) VALUES ('C', '#222222')",
            [],
        )
        .unwrap();
        let cab_id = conn.last_insert_rowid();

        recolor_tags_and_cabinets(
            &conn,
            &[RecolorPatch {
                id: tag_id,
                color: "#aabbcc",
            }],
            &[RecolorPatch {
                id: cab_id,
                color: "#ddeeff",
            }],
        )
        .expect("recolor");

        let tag_color: String = conn
            .query_row("SELECT color FROM tags WHERE id=?1", [tag_id], |r| r.get(0))
            .unwrap();
        let cab_color: String = conn
            .query_row("SELECT color FROM cabinets WHERE id=?1", [cab_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(tag_color, "#aabbcc");
        assert_eq!(cab_color, "#ddeeff");
    }
}

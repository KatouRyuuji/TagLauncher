use super::Migration;
use rusqlite::Connection;

/// 全文索引只跟随索引字段变更，升级时按内容表重建一次。
pub struct V012FtsMaintenance;

impl Migration for V012FtsMaintenance {
    fn version(&self) -> u32 { 12 }
    fn description(&self) -> &str { "Limit full-text maintenance to indexed fields" }
    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch("DROP TRIGGER IF EXISTS items_au;")?;
        conn.execute_batch(crate::db::schema::FTS_UPDATE_TRIGGER)?;
        conn.execute("INSERT INTO items_fts(items_fts) VALUES('rebuild')", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_repairs_fts_and_only_indexed_changes_update_it() {
        let conn = Connection::open_in_memory().unwrap();
        let total_changes = || conn.query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0)).unwrap();
        crate::db::schema::create_tables(&conn).unwrap();
        conn.execute_batch("DROP TRIGGER items_ai; INSERT INTO items(id,name,path,type) VALUES(1,'Before','D:/before','exe');").unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Before'", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
        V012FtsMaintenance.up(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Before'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        let before = total_changes();
        conn.execute("UPDATE items SET is_favorite=1,last_used_at=CURRENT_TIMESTAMP,is_missing=1 WHERE id=1", []).unwrap();
        assert_eq!(total_changes()-before, 1, "状态变更仅写 items 行");
        conn.execute("UPDATE items SET name='After',path='D:/after' WHERE id=1", []).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Before'", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'After'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        let before = total_changes();
        conn.execute("UPDATE items SET name=name,path=path WHERE id=1", []).unwrap();
        assert_eq!(total_changes()-before, 1);
        conn.execute("UPDATE items SET id=2 WHERE id=1", []).unwrap();
        assert_eq!(conn.query_row("SELECT rowid FROM items_fts WHERE items_fts MATCH 'After'", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
        conn.execute("INSERT INTO items_fts(items_fts,rank) VALUES('integrity-check',1)", []).unwrap();
    }
}

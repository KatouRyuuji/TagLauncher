use super::Migration;
use crate::db::has_column;
use rusqlite::Connection;

/// 为对象增加内容签名列（文件大小 + 首/尾采样哈希），用于跨盘符移动后的兜底重定位：
/// 当 NTFS 文件ID 重定位失败（卷序列号变化）时，可在候选盘按内容签名找回同一文件。
///
/// 非破坏性：仅 ADD COLUMN，旧库平滑升级；签名在导入/对账时惰性回填，迁移本身不回填。
pub struct V006ObjectSignature;

impl Migration for V006ObjectSignature {
    fn version(&self) -> u32 {
        6
    }

    fn description(&self) -> &str {
        "Add content signature columns for cross-volume relocation"
    }

    fn up(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        // 幂等：逐列检查后 ADD COLUMN（新库 schema 已含这些列时全部跳过）。
        for (col, decl) in [
            ("sig_size", "sig_size INTEGER"),
            ("sig_head", "sig_head INTEGER"),
            ("sig_tail", "sig_tail INTEGER"),
        ] {
            if !has_column(conn, "items", col) {
                conn.execute_batch(&format!("ALTER TABLE items ADD COLUMN {};", decl))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_signature_columns_idempotently() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                type TEXT,
                is_missing INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO items (name, path, type) VALUES ('a', 'D:\a.exe', 'exe');
            "#,
        )
        .expect("seed");

        V006ObjectSignature.up(&conn).expect("run migration");
        assert!(has_column(&conn, "items", "sig_size"));
        assert!(has_column(&conn, "items", "sig_head"));
        assert!(has_column(&conn, "items", "sig_tail"));

        // 数据无损
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        // 再次执行应幂等（不报"列已存在"）
        V006ObjectSignature.up(&conn).expect("idempotent rerun");
    }
}

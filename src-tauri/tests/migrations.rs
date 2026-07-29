//! 集成测试：迁移链（真实文件库，经真实入口 Database::new）。
//! 覆盖空库全升级到最新、从旧版本(v4)升级时破坏性重建保留外键关联、幂等重跑、
//! 破坏性迁移在有数据时生成快照备份。

mod common;

use tag_launcher_lib::db::Database;

fn schema_version(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn has_column(conn: &rusqlite::Connection, table: &str, col: &str) -> bool {
    let sql = format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'", table, col);
    conn.query_row(&sql, [], |r| r.get::<_, i64>(0)).unwrap() > 0
}

/// 播种一个 v4 版本的真实库文件（path UNIQUE、无身份列、外键 CASCADE 关联 + 真实数据）。
fn seed_v4_file(path: &std::path::Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE items (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
            type TEXT CHECK(type IN ('folder','image','audio','exe','bat','ps1')),
            icon_path TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME, is_favorite INTEGER DEFAULT 0
        );
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);
        CREATE TABLE item_tags (
            item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (item_id, tag_id)
        );
        CREATE TABLE cabinets (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT, created_at DATETIME);
        CREATE TABLE cabinet_items (
            cabinet_id INTEGER REFERENCES cabinets(id) ON DELETE CASCADE,
            item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
            PRIMARY KEY (cabinet_id, item_id)
        );
        CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE VIRTUAL TABLE items_fts USING fts5(name, path, content=items, content_rowid=id);
        INSERT INTO app_meta (key, value) VALUES ('schema_version','4');
        INSERT INTO items (id, name, path, type) VALUES (1,'a','D:\a.exe','exe');
        INSERT INTO tags (id, name, color) VALUES (1,'t','#fff');
        INSERT INTO item_tags (item_id, tag_id, position) VALUES (1,1,0);
        INSERT INTO cabinets (id, name, color) VALUES (1,'c','#fff');
        INSERT INTO cabinet_items (cabinet_id, item_id) VALUES (1,1);
        "#,
    )
    .unwrap();
}

/// 空库经 Database::new 全升级到最新版本（7），身份列 / 层级表就位、外键强制开启。
#[test]
fn fresh_file_db_migrates_to_latest() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    assert_eq!(schema_version(&conn), 7, "全新库应迁移到最新版本");
    assert!(has_column(&conn, "items", "volume_serial"));
    assert!(has_column(&conn, "items", "file_id"));
    assert!(has_column(&conn, "items", "is_missing"));
    assert!(has_column(&conn, "items", "sig_size"));

    let tag_rel: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tag_relations'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tag_rel, 1, "v007 应建出 tag_relations 表");

    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1, "运行期应开启外键强制");
}

/// 从 v4 旧库升级：破坏性重建 items 表（v005）时，item_tags/cabinet_items 关联应存活，
/// 身份列补齐，数据无损。
#[test]
fn upgrade_from_v4_preserves_cascading_relations() {
    let dir = common::TempDir::new("mig_v4");
    let path = dir.db_path();
    seed_v4_file(&path);

    // 经真实入口升级（Database::new 内部 create_tables + run_pending）。
    let db = Database::new(&path).expect("open & migrate v4 db");
    let conn = db.get_conn();

    assert_eq!(schema_version(&conn), 7, "应升级到最新版本");
    let it: i64 = conn.query_row("SELECT COUNT(*) FROM item_tags", [], |r| r.get(0)).unwrap();
    assert_eq!(it, 1, "破坏性重建后 item_tags 关联应存活（外键在事务外被关闭）");
    let ci: i64 = conn.query_row("SELECT COUNT(*) FROM cabinet_items", [], |r| r.get(0)).unwrap();
    assert_eq!(ci, 1, "cabinet_items 关联应存活");
    assert!(has_column(&conn, "items", "file_id"), "身份列应补齐");
    let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(items, 1, "数据无损");
}

/// 有数据的破坏性迁移应在升级前生成快照备份（<db>.pre-v*.bak）。
#[test]
fn breaking_migration_snapshots_backup_when_data_present() {
    let dir = common::TempDir::new("mig_bak");
    let path = dir.db_path();
    seed_v4_file(&path);

    let _db = Database::new(&path).expect("upgrade");

    // v005 为破坏性迁移，且库中有数据 → 应留下升级前快照备份。
    let bak_found = std::fs::read_dir(&dir.path)
        .unwrap()
        .flatten()
        .any(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.contains(".pre-v") && n.ends_with(".bak")
        });
    assert!(bak_found, "有数据的破坏性迁移应生成 .pre-v*.bak 快照备份");
}

/// 幂等重跑：对同一库文件再次 Database::new 不改变版本、数据无损。
#[test]
fn reopening_migrated_db_is_idempotent() {
    let dir = common::TempDir::new("mig_idem");
    let path = dir.db_path();
    seed_v4_file(&path);

    {
        let db1 = Database::new(&path).expect("first open");
        assert_eq!(schema_version(&db1.get_conn()), 7);
    } // 关闭第一个连接

    let db2 = Database::new(&path).expect("reopen");
    let conn = db2.get_conn();
    assert_eq!(schema_version(&conn), 7, "重开版本不变");
    let it: i64 = conn.query_row("SELECT COUNT(*) FROM item_tags", [], |r| r.get(0)).unwrap();
    assert_eq!(it, 1, "重开数据无损");
}

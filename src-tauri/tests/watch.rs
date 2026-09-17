//! 文件夹监视：默认不监视、手动打开后补扫入库、总闸暂停、出库级联。

mod common;

use tag_launcher_lib::services::item_service;
use tag_launcher_lib::services::watch_service;

#[test]
fn new_folder_is_not_watched_until_enabled() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "media");
    common::write_file(&t.dir, "media/keep.mp4", b"old");
    let folder = {
        let conn = t.db.get_conn();
        item_service::add_item(&conn, &root).unwrap()
    };
    common::write_file(&t.dir, "media/new.mp4", b"fresh-bytes");
    let before = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(before.created_count, 0, "未打开监视时补扫不得入库");

    {
        let conn = t.db.get_conn();
        watch_service::set_item_watch(&conn, folder.id, true).unwrap();
    }
    let added = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert!(added.created_count >= 1, "打开监视后应收入新文件");

    common::write_file(&t.dir, "media/later.mp4", b"later");
    {
        let conn = t.db.get_conn();
        watch_service::set_item_watch(&conn, folder.id, false).unwrap();
    }
    let after_off = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(after_off.created_count, 0, "关掉监视后再补扫不得入库");
}

#[test]
fn master_off_pauses_even_if_object_enabled() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "clip");
    let folder = {
        let conn = t.db.get_conn();
        let item = item_service::add_item(&conn, &root).unwrap();
        watch_service::set_item_watch(&conn, item.id, true).unwrap();
        watch_service::set_master_enabled(&conn, false).unwrap();
        item
    };
    common::write_file(&t.dir, "clip/a.mp4", b"aaa");
    let result = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(result.created_count, 0);
    let status = {
        let conn = t.db.get_conn();
        watch_service::status(&conn).unwrap()
    };
    assert!(!status.master_enabled);
    assert_eq!(status.active_count, 0);
    assert!(status.watched_item_ids.contains(&folder.id));
}

#[test]
fn removing_folder_drops_watch_root() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "drop");
    let folder = {
        let conn = t.db.get_conn();
        let item = item_service::add_item(&conn, &root).unwrap();
        watch_service::set_item_watch(&conn, item.id, true).unwrap();
        item
    };
    {
        let conn = t.db.get_conn();
        item_service::remove_item(&conn, folder.id).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM watch_roots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
}

#[test]
fn fresh_db_has_watch_roots_and_schema_14() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let ver: i64 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ver, i64::from(tag_launcher_lib::db::migrations::latest_schema_version()));
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='watch_roots'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);
}

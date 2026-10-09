//! 文件夹监视：默认不监视、手动打开后补扫入库、总闸暂停、出库级联、
//! 补扫只采集新文件、变更通知路径过滤、根目录离线。

mod common;

use tag_launcher_lib::services::item_service;
use std::path::PathBuf;

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

#[test]
fn rescan_collects_only_paths_not_in_library() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "lib");
    common::write_file(&t.dir, "lib/a.mp4", b"aaa");
    common::write_file(&t.dir, "lib/sub/b.png", b"bbb");
    let folder = {
        let conn = t.db.get_conn();
        let item = item_service::add_item(&conn, &root).unwrap();
        watch_service::set_item_watch(&conn, item.id, true).unwrap();
        item
    };
    let first = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(first.created_count, 2);

    common::write_file(&t.dir, "lib/sub/c.mp3", b"ccc");
    let second = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(second.created_count, 1);
    assert_eq!(second.items.len(), 1, "已在库的路径不得再采集");
    assert!(second.items[0].path.ends_with("c.mp3"));

    let third = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(third.created_count, 0);
    assert!(third.items.is_empty());
}

#[test]
fn event_paths_follow_root_and_skip_rules() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "ev");
    let new_file = common::write_file(&t.dir, "ev/new.mp4", b"n");
    let cached = common::write_file(&t.dir, "ev/.cache/x.mp4", b"x");
    let junk = common::write_file(&t.dir, "ev/desktop.ini", b"j");
    let moved_dir = common::make_dir(&t.dir, "ev/pack");
    common::write_file(&t.dir, "ev/pack/one.mp3", b"1");
    common::write_file(&t.dir, "ev/pack/deep/two.png", b"2");
    let outside = common::write_file(&t.dir, "elsewhere.mp4", b"o");

    let files = watch_service::expand_event_paths(
        std::path::Path::new(&root),
        &[
            PathBuf::from(&new_file),
            PathBuf::from(&cached),
            PathBuf::from(&junk),
            PathBuf::from(&moved_dir),
            PathBuf::from(&outside),
            PathBuf::from(&new_file),
            PathBuf::from(&root),
        ],
    );
    assert_eq!(files.len(), 3, "{files:?}");
    assert!(files.iter().any(|p| p.ends_with("new.mp4")));
    assert!(files.iter().any(|p| p.ends_with("one.mp3")));
    assert!(files.iter().any(|p| p.ends_with("two.png")));
}

#[test]
fn event_import_requires_active_watch() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "inc");
    let file = common::write_file(&t.dir, "inc/a.mp4", b"a");
    let folder = {
        let conn = t.db.get_conn();
        item_service::add_item(&conn, &root).unwrap()
    };
    let off = watch_service::import_event_paths(&t.db, folder.id, &[PathBuf::from(&file)]).unwrap();
    assert_eq!(off.created_count, 0, "未打开监视时事件不得入库");
    {
        let conn = t.db.get_conn();
        watch_service::set_item_watch(&conn, folder.id, true).unwrap();
    }
    let on = watch_service::import_event_paths(&t.db, folder.id, &[PathBuf::from(&file)]).unwrap();
    assert_eq!(on.created_count, 1);
}

#[test]
fn offline_root_scans_without_error() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "usb");
    let folder = {
        let conn = t.db.get_conn();
        let item = item_service::add_item(&conn, &root).unwrap();
        watch_service::set_item_watch(&conn, item.id, true).unwrap();
        item
    };
    std::fs::remove_dir_all(&root).unwrap();
    let result = watch_service::scan_root(&t.db, folder.id).unwrap();
    assert_eq!(result.created_count, 0);
    assert!(result.failed.is_empty());
}

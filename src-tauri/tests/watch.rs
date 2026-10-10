//! 文件夹监视：默认不监视、手动打开后补扫入库、总闸暂停、出库级联、
//! 补扫只采集新文件、变更通知路径过滤、根目录离线。

mod common;

use tag_launcher_lib::services::item_service;
use std::path::PathBuf;

use tag_launcher_lib::services::watch_service::{self, RootKey};

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
    let before = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
    assert_eq!(before.created_count, 0, "未打开监视时补扫不得入库");

    {
        let conn = t.db.get_conn();
        watch_service::set_item_watch(&conn, folder.id, true).unwrap();
    }
    let added = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
    assert!(added.created_count >= 1, "打开监视后应收入新文件");

    common::write_file(&t.dir, "media/later.mp4", b"later");
    {
        let conn = t.db.get_conn();
        watch_service::set_item_watch(&conn, folder.id, false).unwrap();
    }
    let after_off = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
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
    let result = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
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
    let first = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
    assert_eq!(first.created_count, 2);

    common::write_file(&t.dir, "lib/sub/c.mp3", b"ccc");
    let second = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
    assert_eq!(second.created_count, 1);
    assert_eq!(second.items.len(), 1, "已在库的路径不得再采集");
    assert!(second.items[0].path.ends_with("c.mp3"));

    let third = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
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
        false,
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
    let off = watch_service::import_event_paths(&t.db, RootKey::Item(folder.id), &[PathBuf::from(&file)]).unwrap();
    assert_eq!(off.created_count, 0, "未打开监视时事件不得入库");
    {
        let conn = t.db.get_conn();
        watch_service::set_item_watch(&conn, folder.id, true).unwrap();
    }
    let on = watch_service::import_event_paths(&t.db, RootKey::Item(folder.id), &[PathBuf::from(&file)]).unwrap();
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
    let result = watch_service::scan_root(&t.db, RootKey::Item(folder.id)).unwrap();
    assert_eq!(result.created_count, 0);
    assert!(result.failed.is_empty());
}

/// 关联柜作为监视根：总闸控制；补扫与通知都收子文件夹；超上限时记录截断标记。
#[test]
fn cabinet_root_includes_folders_and_follows_master() {
    use tag_launcher_lib::services::cabinet_service;
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "shelf");
    common::write_file(&t.dir, "shelf/a.txt", b"a");
    let cab = {
        let conn = t.db.get_conn();
        let cab = cabinet_service::add_cabinet(&conn, "Shelf", "#fff").unwrap();
        cabinet_service::set_cabinet_folder(&conn, cab.id, Some(&root)).unwrap();
        assert!(watch_service::list_active_roots(&conn)
            .unwrap()
            .contains(&(RootKey::Cabinet(cab.id), root.clone())));
        watch_service::set_master_enabled(&conn, false).unwrap();
        cab
    };
    assert_eq!(watch_service::scan_root(&t.db, RootKey::Cabinet(cab.id)).unwrap().created_count, 0);
    {
        let conn = t.db.get_conn();
        watch_service::set_master_enabled(&conn, true).unwrap();
    }
    assert_eq!(watch_service::scan_root(&t.db, RootKey::Cabinet(cab.id)).unwrap().created_count, 1);

    let moved = common::make_dir(&t.dir, "shelf/pack");
    common::write_file(&t.dir, "shelf/pack/deep/b.txt", b"b");
    let added =
        watch_service::import_event_paths(&t.db, RootKey::Cabinet(cab.id), &[PathBuf::from(&moved)])
            .unwrap();
    assert_eq!(added.created_count, 3, "pack、deep、b.txt");
    let conn = t.db.get_conn();
    assert_eq!(cabinet_service::get_cabinet_items(&conn, cab.id).unwrap().len(), 4);
}

/// 不再追踪：监视目录下移出库的对象记入忽略名单，补扫与通知都跳过；文件夹连同其下对象出库；
/// 移到回收站不记名单；手动加回解除忽略；恢复追踪后补扫重新导入；磁盘上已消失的忽略项被清理。
#[test]
fn removed_items_under_watch_root_stay_untracked() {
    use tag_launcher_lib::services::cabinet_service;
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "track");
    let keep = common::write_file(&t.dir, "track/keep.txt", b"k");
    let drop = common::write_file(&t.dir, "track/drop.txt", b"d");
    let sub = common::make_dir(&t.dir, "track/sub");
    let inner = common::write_file(&t.dir, "track/sub/inner.txt", b"i");
    let gone = common::write_file(&t.dir, "track/gone.txt", b"g");
    let cab = {
        let conn = t.db.get_conn();
        let cab = cabinet_service::add_cabinet(&conn, "Track", "#fff").unwrap();
        cabinet_service::set_cabinet_folder(&conn, cab.id, Some(&root)).unwrap();
        cab
    };
    let key = RootKey::Cabinet(cab.id);
    assert_eq!(watch_service::scan_root(&t.db, key).unwrap().created_count, 5);

    let id_of = |path: &str| -> i64 {
        let conn = t.db.get_conn();
        conn.query_row(
            "SELECT id FROM items WHERE replace(path, '/', '\\') = ?1",
            [path.replace('/', "\\")],
            |r| r.get(0),
        )
        .unwrap()
    };
    let count = || -> i64 {
        let conn = t.db.get_conn();
        conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap()
    };
    let (drop_id, sub_id, gone_id) = (id_of(&drop), id_of(&sub), id_of(&gone));
    {
        let conn = t.db.get_conn();
        item_service::remove_items(&conn, &[drop_id, sub_id, gone_id]).unwrap();
        let ignored = watch_service::list_ignored_paths(&conn, Some(&root)).unwrap();
        assert_eq!(ignored.len(), 3, "{ignored:?}");
        assert!(watch_service::list_ignored_paths(&conn, None).unwrap().len() == 3);
    }
    assert_eq!(count(), 1, "只剩 keep.txt；sub 之下的 inner.txt 一并出库");
    assert!(id_of(&keep) > 0);

    assert_eq!(watch_service::scan_root(&t.db, key).unwrap().created_count, 0, "补扫跳过忽略项");
    let ev = watch_service::import_event_paths(
        &t.db,
        key,
        &[PathBuf::from(&drop), PathBuf::from(&inner)],
    )
    .unwrap();
    assert_eq!(ev.created_count, 0, "通知也跳过忽略项及被忽略文件夹之下的路径");

    std::fs::remove_file(&gone).unwrap();
    watch_service::scan_root(&t.db, key).unwrap();
    {
        let conn = t.db.get_conn();
        let ignored = watch_service::list_ignored_paths(&conn, Some(&root)).unwrap();
        assert_eq!(ignored.len(), 2, "已从磁盘消失的忽略项被清理：{ignored:?}");
    }

    let manual = item_service::add_items(&t.db, vec![drop.clone()]);
    assert_eq!(manual.created_count, 1);
    {
        let conn = t.db.get_conn();
        let ignored = watch_service::list_ignored_paths(&conn, None).unwrap();
        assert_eq!(ignored.len(), 1, "手动加回解除忽略：{ignored:?}");
        watch_service::restore_ignored_paths(&conn, &ignored).unwrap();
        assert!(watch_service::list_ignored_paths(&conn, None).unwrap().is_empty());
    }
    assert_eq!(watch_service::scan_root(&t.db, key).unwrap().created_count, 2, "恢复后 sub 与 inner.txt 重新入库");

    let inner_id = id_of(&inner);
    {
        let conn = t.db.get_conn();
        let result = item_service::remove_items_and_files(&conn, &[inner_id]).unwrap();
        assert_eq!(result.removed_ids, vec![inner_id]);
        assert!(
            watch_service::list_ignored_paths(&conn, None).unwrap().is_empty(),
            "移到回收站不记入忽略名单"
        );
    }
}

/// 不在监视目录下（或监视目录本身）的对象移出库时不记入忽略名单。
#[test]
fn removal_outside_watch_roots_is_not_ignored() {
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "plain");
    let file = common::write_file(&t.dir, "plain/a.txt", b"a");
    let conn = t.db.get_conn();
    let folder = item_service::add_item(&conn, &root).unwrap();
    let loose = item_service::add_item(&conn, &file).unwrap();
    item_service::remove_items(&conn, &[loose.id]).unwrap();
    watch_service::set_item_watch(&conn, folder.id, true).unwrap();
    item_service::remove_items(&conn, &[folder.id]).unwrap();
    assert!(watch_service::list_ignored_paths(&conn, None).unwrap().is_empty());
}

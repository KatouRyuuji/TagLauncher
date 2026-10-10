//! 集成测试：文件柜链路（真实文件库）。
//! 覆盖文件柜 CRUD、批量加入/移除、柜间隔离（成员互斥）、删柜级联成员但保留对象、
//! 删对象自动从柜内移除。

mod common;

#[test]
fn cabinet_reconcile_only_scans_current_members() {
    use tag_launcher_lib::services::item_service;
    let fixture = common::temp_db();
    let conn = fixture.db.get_conn();
    conn.execute_batch("INSERT INTO items(id,name,path,type) VALUES(1,'one','Z:/missing-fixture-one','exe'),(2,'two','Z:/missing-fixture-two','exe');
        INSERT INTO cabinets(id,name) VALUES(1,'current'); INSERT INTO cabinet_items(cabinet_id,item_id) VALUES(1,1);").unwrap();
    let snapshot = item_service::read_cabinet_reconcile_snapshot(&conn, 1).unwrap();
    assert_eq!(snapshot.len(), 1);
    let writes = item_service::plan_reconcile(snapshot);
    item_service::apply_reconcile(&conn, &writes).unwrap();
    assert!(item_service::get_item(&conn, 1).unwrap().item.is_missing);
    assert!(!item_service::get_item(&conn, 2).unwrap().item.is_missing);
    assert!(item_service::read_cabinet_reconcile_snapshot(&conn, 99).unwrap().is_empty());
}

use tag_launcher_lib::services::{cabinet_service, item_service};

/// 文件柜 CRUD 往返。
#[test]
fn cabinet_crud_roundtrip() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    let cab = cabinet_service::add_cabinet(&conn, "Games", "#6366f1").expect("add");
    assert_eq!(cab.name, "Games");
    assert_eq!(cabinet_service::get_cabinets(&conn).unwrap().len(), 1);

    cabinet_service::update_cabinet(&conn, cab.id, "Work", "#000000").expect("update");
    let after = cabinet_service::get_cabinets(&conn).unwrap();
    assert_eq!(after[0].name, "Work");
    assert_eq!(after[0].color, "#000000");

    cabinet_service::remove_cabinet(&conn, cab.id).expect("remove");
    assert!(cabinet_service::get_cabinets(&conn).unwrap().is_empty());
}

#[test]
fn cabinet_add_and_update_reject_empty_or_whitespace_name() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let cab = cabinet_service::add_cabinet(&conn, "Games", "#fff").unwrap();
    for name in ["", "   ", "\t"] {
        assert!(
            cabinet_service::add_cabinet(&conn, name, "#fff")
                .unwrap_err()
                .contains("不能为空"),
            "add {name:?}"
        );
        assert!(
            cabinet_service::update_cabinet(&conn, cab.id, name, "#fff")
                .unwrap_err()
                .contains("不能为空"),
            "update {name:?}"
        );
    }
    assert_eq!(cabinet_service::get_cabinets(&conn).unwrap()[0].name, "Games");
}

/// 批量加入（幂等）与批量移除。
#[test]
fn batch_add_and_remove_cabinet_items() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let cab = cabinet_service::add_cabinet(&conn, "C", "#fff").unwrap();
    let a = item_service::add_item(&conn, &common::write_file(&t.dir, "1.exe", b"a")).unwrap();
    let b = item_service::add_item(&conn, &common::write_file(&t.dir, "2.exe", b"b")).unwrap();
    let c = item_service::add_item(&conn, &common::write_file(&t.dir, "3.exe", b"c")).unwrap();

    cabinet_service::add_items_to_cabinet(&conn, cab.id, &[a.id, b.id, c.id]).expect("batch add");
    // 幂等：重复加入不产生重复成员。
    cabinet_service::add_items_to_cabinet(&conn, cab.id, &[a.id]).expect("idempotent");
    assert_eq!(cabinet_service::get_cabinet_items(&conn, cab.id).unwrap().len(), 3);

    cabinet_service::remove_items_from_cabinet(&conn, cab.id, &[a.id, c.id]).expect("batch remove");
    let left = cabinet_service::get_cabinet_items(&conn, cab.id).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].item.id, b.id);
}

/// 柜间成员互斥：加入 A 柜的对象不出现在 B 柜。
#[test]
fn cabinets_isolate_membership() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let cab_a = cabinet_service::add_cabinet(&conn, "A", "#fff").unwrap();
    let cab_b = cabinet_service::add_cabinet(&conn, "B", "#fff").unwrap();
    let x = item_service::add_item(&conn, &common::write_file(&t.dir, "x.exe", b"a")).unwrap();
    let y = item_service::add_item(&conn, &common::write_file(&t.dir, "y.exe", b"b")).unwrap();

    cabinet_service::add_item_to_cabinet(&conn, cab_a.id, x.id).unwrap();
    cabinet_service::add_item_to_cabinet(&conn, cab_b.id, y.id).unwrap();

    let in_a = cabinet_service::get_cabinet_items(&conn, cab_a.id).unwrap();
    let in_b = cabinet_service::get_cabinet_items(&conn, cab_b.id).unwrap();
    assert_eq!(in_a.len(), 1);
    assert_eq!(in_a[0].item.id, x.id);
    assert_eq!(in_b.len(), 1);
    assert_eq!(in_b[0].item.id, y.id);
}

/// 删除文件柜级联删除其成员关联，但对象本身保留（成员表 FK 指向 cabinets）。
#[test]
fn deleting_cabinet_cascades_membership_but_keeps_items() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let cab = cabinet_service::add_cabinet(&conn, "C", "#fff").unwrap();
    let a = item_service::add_item(&conn, &common::write_file(&t.dir, "keep.exe", b"a")).unwrap();
    cabinet_service::add_item_to_cabinet(&conn, cab.id, a.id).unwrap();

    cabinet_service::remove_cabinet(&conn, cab.id).unwrap();

    let membership: i64 = conn
        .query_row("SELECT COUNT(*) FROM cabinet_items WHERE cabinet_id=?1", [cab.id], |r| r.get(0))
        .unwrap();
    assert_eq!(membership, 0, "删柜应级联删除成员关联");
    let item_exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM items WHERE id=?1", [a.id], |r| r.get(0))
        .unwrap();
    assert_eq!(item_exists, 1, "对象本身应保留");
}

/// 删除对象自动从所有文件柜中移除（成员表 FK 指向 items，ON DELETE CASCADE）。
#[test]
fn deleting_item_removes_it_from_cabinets() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let cab = cabinet_service::add_cabinet(&conn, "C", "#fff").unwrap();
    let a = item_service::add_item(&conn, &common::write_file(&t.dir, "gone.exe", b"a")).unwrap();
    cabinet_service::add_item_to_cabinet(&conn, cab.id, a.id).unwrap();
    assert_eq!(cabinet_service::get_cabinet_items(&conn, cab.id).unwrap().len(), 1);

    item_service::remove_item(&conn, a.id).unwrap();

    assert!(
        cabinet_service::get_cabinet_items(&conn, cab.id).unwrap().is_empty(),
        "删除对象应自动从柜内移除"
    );
}

/// 关联文件夹：成员按路径计算（含子文件夹、不含根本身、`_` 不作通配），手动增删被拒，
/// 同一文件夹不能关联两个柜，解除后成员固化为普通柜。
#[test]
fn linked_cabinet_members_follow_folder() {
    use tag_launcher_lib::services::watch_service::{self, RootKey};
    let t = common::temp_db();
    let root = common::make_dir(&t.dir, "lib_a");
    common::write_file(&t.dir, "lib_a/top.txt", b"t");
    common::write_file(&t.dir, "lib_a/sub/inner.txt", b"i");
    common::write_file(&t.dir, "lib_a/.hidden/skip.txt", b"h");
    let sibling = common::write_file(&t.dir, "libXa/look-alike.txt", b"x");
    let (cab, other, outside) = {
        let conn = t.db.get_conn();
        let cab = cabinet_service::add_cabinet(&conn, "Linked", "#fff").unwrap();
        let other = cabinet_service::add_cabinet(&conn, "Other", "#000").unwrap();
        let outside = item_service::add_item(&conn, &sibling).unwrap();
        cabinet_service::add_item_to_cabinet(&conn, cab.id, outside.id).unwrap();
        cabinet_service::set_cabinet_folder(&conn, cab.id, Some(&format!("{root}\\"))).unwrap();
        (cab, other, outside)
    };
    let scanned = watch_service::scan_root(&t.db, RootKey::Cabinet(cab.id)).unwrap();
    assert_eq!(scanned.created_count, 3, "top.txt、sub、sub/inner.txt");

    let conn = t.db.get_conn();
    let cabinets = cabinet_service::get_cabinets(&conn).unwrap();
    let linked = cabinets.iter().find(|c| c.id == cab.id).unwrap();
    assert_eq!(linked.folder_path.as_deref(), Some(root.as_str()), "末尾分隔符被规范化去掉");
    assert!(!linked.folder_truncated);
    let items = cabinet_service::get_cabinet_items(&conn, cab.id).unwrap();
    let mut names: Vec<_> = items.iter().map(|i| i.item.name.clone()).collect();
    names.sort();
    assert_eq!(names.len(), 3, "{names:?}");
    assert!(items.iter().any(|i| i.item.item_type == "folder"));
    assert!(items.iter().all(|i| i.item.id != outside.id), "关联时清空手动成员，形似路径不算成员");
    let counts: std::collections::HashMap<i64, i64> =
        cabinet_service::get_cabinet_item_counts(&conn).unwrap().into_iter().collect();
    assert_eq!(counts.get(&cab.id), Some(&3));

    let err = cabinet_service::add_item_to_cabinet(&conn, cab.id, outside.id).unwrap_err();
    assert_eq!(err, "关联文件夹的文件柜内容由文件夹决定");
    assert!(cabinet_service::remove_items_from_cabinet(&conn, cab.id, &[outside.id]).is_err());
    let dup = cabinet_service::set_cabinet_folder(&conn, other.id, Some(&root.to_uppercase()))
        .unwrap_err();
    assert_eq!(dup, "该文件夹已关联到其他文件柜");

    cabinet_service::set_cabinet_folder(&conn, cab.id, None).unwrap();
    cabinet_service::set_cabinet_folder(&conn, cab.id, None).unwrap();
    let after = cabinet_service::get_cabinets(&conn).unwrap();
    assert!(after.iter().all(|c| c.folder_path.is_none()));
    assert_eq!(cabinet_service::get_cabinet_items(&conn, cab.id).unwrap().len(), 3, "解除后成员固化");
    cabinet_service::add_item_to_cabinet(&conn, cab.id, outside.id).unwrap();
    assert_eq!(cabinet_service::get_cabinet_items(&conn, cab.id).unwrap().len(), 4);
}

#[test]
fn linked_cabinet_rejects_missing_folder_and_reports_state() {
    let t = common::temp_db();
    let gone = t.dir.join("not-there").to_string_lossy().to_string();
    let conn = t.db.get_conn();
    let cab = cabinet_service::add_cabinet(&conn, "Linked", "#fff").unwrap();
    assert!(cabinet_service::set_cabinet_folder(&conn, cab.id, Some(&gone)).is_err());
    assert!(cabinet_service::set_cabinet_folder(&conn, 999, Some(&gone)).is_err());
    assert_eq!(cabinet_service::folder_state(&gone), "missing");
    assert_eq!(cabinet_service::folder_state(&t.dir.path.to_string_lossy()), "ok");
}

/// 关联柜所在盘离线时其前缀被列入对账跳过名单，盘在（文件夹被删）时不跳过。
#[test]
fn offline_drive_prefix_is_skipped_by_reconcile() {
    let absent = ('Q'..='Y').find(|d| !std::path::Path::new(&format!("{d}:\\")).exists());
    let Some(drive) = absent else {
        return;
    };
    let t = common::temp_db();
    let gone = t.dir.join("deleted").to_string_lossy().to_string();
    let bound = vec![(1, format!("{drive}:\\Media")), (2, gone)];
    let prefixes = cabinet_service::offline_folder_prefixes(&bound);
    assert_eq!(prefixes, vec![format!("{drive}:\\Media\\")]);
    assert!(cabinet_service::path_under(&format!("{}:/media/a.mp4", drive.to_ascii_lowercase()), &prefixes[0]));
    assert!(!cabinet_service::path_under(&format!("{drive}:\\Media2\\a.mp4"), &prefixes[0]));
}

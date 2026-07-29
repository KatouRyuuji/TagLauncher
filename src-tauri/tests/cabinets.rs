//! 集成测试：文件柜链路（真实文件库）。
//! 覆盖文件柜 CRUD、批量加入/移除、柜间隔离（成员互斥）、删柜级联成员但保留对象、
//! 删对象自动从柜内移除。

mod common;

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

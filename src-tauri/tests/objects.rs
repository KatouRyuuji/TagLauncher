//! 集成测试：对象管理链路（真实文件库 + 跨模块）。
//! 覆盖 add_items 单项失败隔离、真实文件去重、get_items、remove_items 分块、
//! toggle_favorite、detect_type 全类型（真实文件系统对象）、get_items_by_ids 排序去重。

mod common;

use tag_launcher_lib::services::item_service;

/// add_items：批内单项失败（空路径）被隔离，不阻断整批其余项落库。
#[test]
fn add_items_isolates_single_failure_without_aborting_batch() {
    let t = common::temp_db();
    let good1 = common::write_file(&t.dir, "app1.exe", b"x");
    let good2 = common::write_file(&t.dir, "app2.exe", b"y");

    let mut conn = t.db.get_conn();
    let result = item_service::add_items(
        &mut conn,
        vec![good1.clone(), "   ".to_string(), good2.clone()],
    );

    assert_eq!(result.items.len(), 2, "两个合法路径应成功入库");
    assert_eq!(result.failed.len(), 1, "空白路径应作为单项失败被隔离");
    assert_eq!(result.failed[0].path, "   ");
    // 其余项确实持久化了（整批未回滚）。
    let cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cnt, 2);
}

/// 真实文件重复加入去重为同一条记录（身份或 path 去重，二者之一命中）。
#[test]
fn add_item_dedups_same_real_file() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "dup.exe", b"same");
    let conn = t.db.get_conn();

    let a = item_service::add_item(&conn, &path).expect("add 1");
    let b = item_service::add_item(&conn, &path).expect("add 2");
    assert_eq!(a.id, b.id, "同一真实文件重复加入应去重为同一记录");

    let cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cnt, 1);
}

/// detect_type 覆盖全部类型分支——用**真实**文件系统对象，
/// 尤其目录分支依赖 `is_dir()`，只有真实目录才能覆盖。
#[test]
fn detect_type_classifies_real_filesystem_objects() {
    let t = common::temp_db();

    let dir = common::make_dir(&t.dir, "some_folder");
    let mp3 = common::write_file(&t.dir, "track.mp3", b"a");
    let png = common::write_file(&t.dir, "pic.PNG", b"a"); // 大写扩展名也应识别
    let exe = common::write_file(&t.dir, "tool.exe", b"a");
    let bat = common::write_file(&t.dir, "run.bat", b"a");
    let cmd = common::write_file(&t.dir, "run.cmd", b"a");
    let ps1 = common::write_file(&t.dir, "s.ps1", b"a");
    let unknown = common::write_file(&t.dir, "data.xyz", b"a");

    assert_eq!(item_service::detect_type(&dir), "folder");
    assert_eq!(item_service::detect_type(&mp3), "audio");
    assert_eq!(item_service::detect_type(&png), "image");
    assert_eq!(item_service::detect_type(&exe), "exe");
    assert_eq!(item_service::detect_type(&bat), "bat");
    assert_eq!(item_service::detect_type(&cmd), "bat");
    assert_eq!(item_service::detect_type(&ps1), "ps1");
    assert_eq!(item_service::detect_type(&unknown), "exe");

    // 经 add_item 落库后类型一致（走完整入库管线）。
    let conn = t.db.get_conn();
    let item = item_service::add_item(&conn, &mp3).expect("add mp3");
    assert_eq!(item.item_type, "audio");
    let folder = item_service::add_item(&conn, &dir).expect("add folder");
    assert_eq!(folder.item_type, "folder");
}

/// get_items 返回全部对象，默认排序：收藏优先。
#[test]
fn get_items_returns_all_with_favorites_first() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    let a = item_service::add_item(&conn, &common::write_file(&t.dir, "Alpha.exe", b"a")).unwrap();
    let _b = item_service::add_item(&conn, &common::write_file(&t.dir, "Beta.exe", b"b")).unwrap();
    let _c = item_service::add_item(&conn, &common::write_file(&t.dir, "Gamma.exe", b"c")).unwrap();

    item_service::toggle_favorite(&conn, a.id).expect("favorite a");

    let items = item_service::get_items(&conn).expect("get_items");
    assert_eq!(items.len(), 3);
    assert!(items[0].item.is_favorite, "收藏项应排在最前");
    assert_eq!(items[0].item.id, a.id);
}

/// remove_items 超过 IN_CHUNK(500) 分块删除，整体原子清空。
#[test]
fn remove_items_chunked_over_500_atomic() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    {
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..600i64 {
            tx.execute(
                "INSERT INTO items (name, path, type) VALUES (?1, ?2, 'exe')",
                rusqlite::params![format!("i{:04}", i), format!(r"D:\n\{}.exe", i)],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM items").unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };
    assert_eq!(ids.len(), 600);

    item_service::remove_items(&conn, &ids).expect("chunked remove");
    let remaining: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(remaining, 0);
}

/// toggle_favorite 翻转往返；对不存在的 id 返回错误。
#[test]
fn toggle_favorite_roundtrip_and_errors_on_missing() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let item = item_service::add_item(&conn, &common::write_file(&t.dir, "fav.exe", b"a")).unwrap();

    assert!(item_service::toggle_favorite(&conn, item.id).unwrap(), "首次翻转为收藏");
    assert!(!item_service::toggle_favorite(&conn, item.id).unwrap(), "再翻转取消收藏");
    assert!(
        item_service::toggle_favorite(&conn, 999_999).is_err(),
        "不存在的 id 应返回错误"
    );
}

/// get_items_by_ids：去重 id、按默认顺序（收藏优先）返回、且仅返回请求的子集。
#[test]
fn get_items_by_ids_dedups_and_orders() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let a = item_service::add_item(&conn, &common::write_file(&t.dir, "A.exe", b"a")).unwrap();
    let b = item_service::add_item(&conn, &common::write_file(&t.dir, "B.exe", b"b")).unwrap();
    let c = item_service::add_item(&conn, &common::write_file(&t.dir, "C.exe", b"c")).unwrap();
    item_service::toggle_favorite(&conn, c.id).unwrap();

    // 请求含重复 id 的 [a, a, c]；应去重为 2 条，收藏的 c 排最前，b 不在结果内。
    let got = item_service::get_items_by_ids(&conn, &[a.id, a.id, c.id]).expect("by ids");
    assert_eq!(got.len(), 2, "重复 id 应去重");
    assert_eq!(got[0].item.id, c.id, "收藏项排最前");
    assert!(got.iter().all(|i| i.item.id != b.id), "未请求的 b 不应出现");
}

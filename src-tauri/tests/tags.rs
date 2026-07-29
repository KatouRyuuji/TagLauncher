//! 集成测试：标签链路（真实文件库）。
//! 覆盖标签 CRUD、set_item_tags 顺序保持（经公开读路径 get_item 验证）、
//! set_many_item_tags 原子批量、add_tag_relation 环检测、后代闭包展开（WITH RECURSIVE 多继承）、
//! 删除标签级联清理关系边与对象关联。

mod common;

use tag_launcher_lib::services::{item_service, tag_service};

fn tag_id(conn: &rusqlite::Connection, name: &str) -> i64 {
    conn.query_row("SELECT id FROM tags WHERE name=?1", [name], |r| r.get(0))
        .unwrap()
}

/// 标签 CRUD 往返。
#[test]
fn tag_crud_roundtrip() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    let tag = tag_service::add_tag(&conn, "开发工具", "#3b82f6").expect("add");
    assert_eq!(tag.name, "开发工具");
    assert_eq!(tag_service::get_tags(&conn).unwrap().len(), 1);

    tag_service::update_tag(&conn, tag.id, "工具", "#ff0000").expect("update");
    let after = tag_service::get_tags(&conn).unwrap();
    assert_eq!(after[0].name, "工具");
    assert_eq!(after[0].color, "#ff0000");

    tag_service::remove_tag(&conn, tag.id).expect("remove");
    assert!(tag_service::get_tags(&conn).unwrap().is_empty());
}

/// set_item_tags 全量替换并保持给定顺序——通过公开读路径 get_item 的 tags 顺序验证。
#[test]
fn set_item_tags_preserves_order_via_public_read() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let item = item_service::add_item(&conn, &common::write_file(&t.dir, "x.exe", b"a")).unwrap();

    let a = tag_service::add_tag(&conn, "Alpha", "#fff").unwrap();
    let b = tag_service::add_tag(&conn, "Beta", "#fff").unwrap();
    let c = tag_service::add_tag(&conn, "Gamma", "#fff").unwrap();

    // 以非字母序设定：Gamma, Alpha, Beta —— 读回应保持该顺序（position 而非名称序）。
    tag_service::set_item_tags(&conn, item.id, &[c.id, a.id, b.id]).expect("set tags");
    let read = item_service::get_item(&conn, item.id).expect("get_item");
    let names: Vec<&str> = read.tags.iter().map(|tg| tg.name.as_str()).collect();
    assert_eq!(names, vec!["Gamma", "Alpha", "Beta"]);

    // 再次全量替换为子集 → 覆盖而非追加。
    tag_service::set_item_tags(&conn, item.id, &[b.id]).expect("replace");
    let read2 = item_service::get_item(&conn, item.id).expect("get_item 2");
    assert_eq!(read2.tags.len(), 1);
    assert_eq!(read2.tags[0].name, "Beta");
}

/// set_many_item_tags 一个事务原子应用多对象的标签变更。
#[test]
fn set_many_item_tags_applies_atomically() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let i1 = item_service::add_item(&conn, &common::write_file(&t.dir, "1.exe", b"a")).unwrap();
    let i2 = item_service::add_item(&conn, &common::write_file(&t.dir, "2.exe", b"b")).unwrap();
    let t1 = tag_service::add_tag(&conn, "T1", "#fff").unwrap();
    let t2 = tag_service::add_tag(&conn, "T2", "#fff").unwrap();

    tag_service::set_many_item_tags(&conn, &[(i1.id, vec![t1.id, t2.id]), (i2.id, vec![t2.id])])
        .expect("set many");

    assert_eq!(item_service::get_item(&conn, i1.id).unwrap().tags.len(), 2);
    let i2_tags = item_service::get_item(&conn, i2.id).unwrap().tags;
    assert_eq!(i2_tags.len(), 1);
    assert_eq!(i2_tags[0].name, "T2");
}

/// add_tag_relation：拒绝自环、拒绝成环；重复添加幂等。
#[test]
fn add_tag_relation_rejects_self_loop_and_cycle() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    for n in ["a", "b", "c"] {
        tag_service::add_tag(&conn, n, "#fff").unwrap();
    }
    let (a, b, c) = (tag_id(&conn, "a"), tag_id(&conn, "b"), tag_id(&conn, "c"));

    tag_service::add_tag_relation(&conn, a, b).expect("a->b");
    tag_service::add_tag_relation(&conn, b, c).expect("b->c");

    assert!(tag_service::add_tag_relation(&conn, a, a).is_err(), "自环应拒绝");
    assert!(
        tag_service::add_tag_relation(&conn, c, a).is_err(),
        "c->a 会成环（a 已是 c 的祖先）应拒绝"
    );

    // 幂等：重复添加已存在的边不报错、不产生重复。
    tag_service::add_tag_relation(&conn, a, b).expect("idempotent a->b");
    assert_eq!(tag_service::get_tag_relations(&conn).unwrap().len(), 2);
}

/// expand_with_descendants：沿 child 边闭包展开（含自身），支持多继承 DAG。
#[test]
fn expand_with_descendants_covers_dag_closure() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    for n in ["root", "mid", "leaf", "other"] {
        tag_service::add_tag(&conn, n, "#fff").unwrap();
    }
    let root = tag_id(&conn, "root");
    let mid = tag_id(&conn, "mid");
    let leaf = tag_id(&conn, "leaf");
    let other = tag_id(&conn, "other");

    // root → mid → leaf；另 other → leaf（leaf 多父）。
    tag_service::add_tag_relation(&conn, root, mid).unwrap();
    tag_service::add_tag_relation(&conn, mid, leaf).unwrap();
    tag_service::add_tag_relation(&conn, other, leaf).unwrap();

    let mut exp = tag_service::expand_with_descendants(&conn, &[root]).unwrap();
    exp.sort();
    let mut want = vec![root, mid, leaf];
    want.sort();
    assert_eq!(exp, want, "root 的后代闭包应为 {{root, mid, leaf}}");

    // 删除 mid->leaf 后，从 root 不再可达 leaf。
    tag_service::remove_tag_relation(&conn, mid, leaf).unwrap();
    let mut exp2 = tag_service::expand_with_descendants(&conn, &[root]).unwrap();
    exp2.sort();
    let mut want2 = vec![root, mid];
    want2.sort();
    assert_eq!(exp2, want2);
}

/// 删除标签级联清理其关系边与对象关联（外键 ON DELETE CASCADE）。
#[test]
fn deleting_tag_cascades_relations_and_item_links() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let item = item_service::add_item(&conn, &common::write_file(&t.dir, "z.exe", b"a")).unwrap();
    let parent = tag_service::add_tag(&conn, "parent", "#fff").unwrap();
    let child = tag_service::add_tag(&conn, "child", "#fff").unwrap();
    tag_service::add_tag_relation(&conn, parent.id, child.id).unwrap();
    tag_service::set_item_tags(&conn, item.id, &[parent.id]).unwrap();

    tag_service::remove_tag(&conn, parent.id).unwrap();

    assert!(
        tag_service::get_tag_relations(&conn).unwrap().is_empty(),
        "删除标签应级联删除其关系边"
    );
    let links: i64 = conn
        .query_row("SELECT COUNT(*) FROM item_tags WHERE tag_id=?1", [parent.id], |r| r.get(0))
        .unwrap();
    assert_eq!(links, 0, "删除标签应级联删除对象-标签关联");
}

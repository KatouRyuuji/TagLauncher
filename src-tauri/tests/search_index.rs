//! 集成测试：内存搜索索引（主窗 view_query 与快速窗 quick_search 共用）。
//! 真实文件库：写连接写入，经只读连接的 data_version 让索引自动跟上；
//! 打分语义本身由 src/search/corpus_tests.rs 与旧 TS 实现逐条对照。

mod common;

use tag_launcher_lib::services::search_index::{SearchIndex, SearchParams};
use tag_launcher_lib::services::{item_service, tag_service};

fn add(t: &common::TestDb, file: &str) -> i64 {
    let conn = t.db.get_conn();
    item_service::add_item(&conn, &common::write_file(&t.dir, file, b"x"))
        .unwrap()
        .id
}

fn q(query: &str) -> SearchParams {
    SearchParams {
        query: query.into(),
        mode: "all".into(),
        ..Default::default()
    }
}

fn no_synonyms() -> Vec<Vec<String>> {
    Vec::new()
}

#[test]
fn index_follows_writes_pinyin_tags_and_scope() {
    let t = common::temp_db();
    let cq = add(&t, "重庆攻略.txt");
    let vs = add(&t, "Visual Studio Code.exe");
    let idx = SearchIndex::default();
    let search = |p: &SearchParams| {
        let ro = t.db.read_conn().unwrap();
        idx.search(ro.conn(), p, &no_synonyms).unwrap()
    };
    assert_eq!(search(&q("cq")), vec![cq], "首字母");
    assert_eq!(search(&q("chongqing")), vec![cq], "全拼（多音字 重=chong）");
    assert_eq!(search(&q("vsc")), vec![vs], "英文缩写");
    assert_eq!(idx.stats().builds, 1);

    // 本应用写连接提交 → 下一次查询前自动重建
    let tag = {
        let conn = t.db.get_conn();
        let tag = tag_service::add_tag(&conn, "工具", "#888888").unwrap();
        tag_service::set_item_tags(&conn, vs, &[tag.id]).unwrap();
        tag
    };
    assert_eq!(search(&q("gj")), vec![vs], "标签拼音首字母");
    let st = idx.stats();
    assert_eq!(st.builds, 2);
    assert_eq!(st.last_build_new_texts, 1, "只为新出现的标签名分词");

    // 范围：只在给定对象里，按给定顺序
    let third = add(&t, "vscode-portable.exe");
    let mut scoped = q("v");
    scoped.scope = Some(vec![third, vs, 9999]);
    assert_eq!(search(&scoped), vec![third, vs]);
    let mut tag_only = q("工具");
    tag_only.mode = "tag".into();
    assert_eq!(search(&tag_only), vec![vs]);
    let _ = tag;

    // 类型 / 丢失筛选
    let mut exe = q("v");
    exe.type_filter = "exe".into();
    assert_eq!(search(&exe).len(), 2);
    t.db.get_conn()
        .execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [third])
        .unwrap();
    {
        let ro = t.db.read_conn().unwrap();
        idx.refresh_if_built(ro.conn()).unwrap();
    }
    let mut hide = q("v");
    hide.hide_missing = true;
    assert_eq!(search(&hide), vec![vs]);
}

#[test]
fn refresh_before_first_build_is_noop_and_empty_query_keeps_default_order() {
    let t = common::temp_db();
    let a = add(&t, "b-second.txt");
    let b = add(&t, "a-first.txt");
    let idx = SearchIndex::default();
    {
        let ro = t.db.read_conn().unwrap();
        idx.refresh_if_built(ro.conn()).unwrap();
    }
    assert_eq!(idx.stats().builds, 0, "没人搜过就不建索引");
    t.db.get_conn()
        .execute("UPDATE items SET is_favorite = 1 WHERE id = ?1", [a])
        .unwrap();
    let ro = t.db.read_conn().unwrap();
    assert_eq!(
        idx.search(ro.conn(), &q(""), &no_synonyms).unwrap(),
        vec![a, b],
        "空查询 = get_items 默认排序（收藏优先）"
    );
    assert_eq!(
        idx.search(ro.conn(), &q("@"), &no_synonyms).unwrap(),
        Vec::<i64>::new()
    );
}

/// 主窗视图：真实库上的筛选排序、冻结键、柜成员与计数（视图语义本身由 src/view/corpus_tests.rs 对照旧 TS）。
#[test]
fn view_query_follows_db_with_frozen_smart_order() {
    use tag_launcher_lib::services::cabinet_service;
    use tag_launcher_lib::services::search_index::ViewRequest;
    use tag_launcher_lib::view::{Scope, ViewParams};

    let t = common::temp_db();
    let a = add(&t, "file10.txt");
    let b = add(&t, "file2.txt");
    let idx = SearchIndex::default();
    let view = |params: ViewParams, query: &str, refreeze: bool| {
        let ro = t.db.read_conn().unwrap();
        let req = ViewRequest {
            params,
            query: query.into(),
            mode: "all".into(),
            refreeze,
        };
        idx.view(ro.conn(), &req, &no_synonyms).unwrap()
    };
    let mut by_name = ViewParams::default();
    by_name.sort_mode = "name".into();
    assert_eq!(view(by_name, "", true).ids, vec![b, a], "自然数字序");

    // 启动 file10：smart 顺序在下一个显式重排点前不变
    t.db.get_conn()
        .execute(
            "UPDATE items SET last_used_at = '2026-11-10 12:00:00' WHERE id = ?1",
            [a],
        )
        .unwrap();
    let smart = ViewParams::default();
    let before = view(smart.clone(), "", false).ids;
    assert_eq!(view(smart.clone(), "", false).ids, before);
    assert_eq!(
        view(smart.clone(), "", true).ids[0],
        a,
        "重拍后最近使用升顶"
    );

    // 搜索走同一入口；文件柜成员由后端解析。file10 对 file2 按英文低容错同档命中，
    // 同档内沿用冻结视图顺序（a 已升顶）；带扩展名的完整查询只剩 b
    assert_eq!(view(smart.clone(), "file2", false).ids, vec![a, b]);
    assert_eq!(view(smart.clone(), "file2.txt", false).ids, vec![b]);

    // typeahead 在同一视图里找：前缀命中按视图顺序（a 已升顶）、子串兜底
    let ta = |text: &str| {
        let ro = t.db.read_conn().unwrap();
        let req = ViewRequest {
            params: smart.clone(),
            query: String::new(),
            mode: "all".into(),
            refreeze: false,
        };
        idx.typeahead(ro.conn(), &req, text, &no_synonyms).unwrap()
    };
    assert_eq!((ta("file"), ta("2.t"), ta("zz")), (Some(a), Some(b), None));
    let (members, folder) = {
        let conn = t.db.get_conn();
        cabinet_service::cabinet_member_ids(&conn, 9999, true).unwrap()
    };
    assert!(
        members.is_empty() && folder.is_none(),
        "不存在的柜按空普通柜"
    );
    let mut cab = smart.clone();
    cab.scope = Scope::Cabinet {
        members: vec![b],
        linked_folder: None,
    };
    assert_eq!(view(cab, "", false).ids, vec![b]);

    let stats = {
        let ro = t.db.read_conn().unwrap();
        idx.library_stats(ro.conn(), &[], &no_synonyms).unwrap()
    };
    assert_eq!((stats.total, stats.recent, stats.untagged), (2, 1, 2));
}

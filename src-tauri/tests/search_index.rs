//! 集成测试：内存搜索索引（主窗 search_query 与快速窗 quick_search 共用）。
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

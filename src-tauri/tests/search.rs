//! 集成测试：搜索链路（真实文件库，经公开 search_items 分发器）。
//! 覆盖三模式（全部 / 名称 FTS / 标签）、层级标签后代展开（每组 EXISTS）、
//! 标签 AND 交集语义、特殊符号回退 LIKE、中文匹配、文本+标签组合。

mod common;

use tag_launcher_lib::services::{item_service, search_service, tag_service};

/// 便捷：新建一个真实文件对象，返回其 id。
fn add(t: &common::TestDb, file: &str) -> i64 {
    let conn = t.db.get_conn();
    item_service::add_item(&conn, &common::write_file(&t.dir, file, b"x"))
        .unwrap()
        .id
}

/// 空查询 + 无标签 → 返回全部对象。
#[test]
fn search_all_mode_returns_everything() {
    let t = common::temp_db();
    add(&t, "Alpha.exe");
    add(&t, "Beta.exe");
    let conn = t.db.get_conn();
    let items = search_service::search_items(&conn, "", &[]).expect("search all");
    assert_eq!(items.len(), 2);
}

/// 仅名称查询 → FTS 前缀匹配命中名称/路径。
#[test]
fn search_by_name_matches_via_fts() {
    let t = common::temp_db();
    add(&t, "PhotoEditor.exe");
    add(&t, "Calculator.exe");
    let conn = t.db.get_conn();

    let hits = search_service::search_items(&conn, "Photo", &[]).expect("search name");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item.name, "PhotoEditor.exe");
}

/// 仅标签查询 → 多标签之间 AND 交集语义。
#[test]
fn search_by_tags_uses_and_intersection() {
    let t = common::temp_db();
    let alpha = add(&t, "Alpha.exe");
    let beta = add(&t, "Beta.exe");
    let conn = t.db.get_conn();

    let tool = tag_service::add_tag(&conn, "工具", "#fff").unwrap();
    let game = tag_service::add_tag(&conn, "游戏", "#fff").unwrap();
    // Alpha: 工具+游戏；Beta: 仅工具
    tag_service::set_item_tags(&conn, alpha, &[tool.id, game.id]).unwrap();
    tag_service::set_item_tags(&conn, beta, &[tool.id]).unwrap();

    // 同时选中 工具 与 游戏 → 仅交集 Alpha。
    let hits = search_service::search_items(&conn, "", &[tool.id, game.id]).expect("search tags");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item.name, "Alpha.exe");
}

/// 层级标签：选中父标签并入其后代标签的对象（每组 EXISTS 展开后代）。
#[test]
fn search_by_parent_tag_includes_descendant_tagged_items() {
    let t = common::temp_db();
    let game_item = add(&t, "GameA.exe");
    let _tool_item = add(&t, "ToolB.exe");
    let conn = t.db.get_conn();

    // 层级：娱乐(父) → 游戏(子)；GameA 仅打"游戏"。
    let ent = tag_service::add_tag(&conn, "娱乐", "#fff").unwrap();
    let game = tag_service::add_tag(&conn, "游戏", "#fff").unwrap();
    tag_service::add_tag_relation(&conn, ent.id, game.id).unwrap();
    tag_service::set_item_tags(&conn, game_item, &[game.id]).unwrap();

    // 选父标签"娱乐" → 应并入子标签"游戏"的对象 GameA。
    let hits = search_service::search_items(&conn, "", &[ent.id]).expect("search parent tag");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item.name, "GameA.exe");
}

/// 含特殊符号（括号）的查询不应报错，经 LIKE 回退仍能命中。
#[test]
fn search_special_symbols_fall_back_to_like() {
    let t = common::temp_db();
    add(&t, "foo(bar).exe");
    let conn = t.db.get_conn();

    let hits = search_service::search_items(&conn, "foo(bar)", &[]).expect("special symbols");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item.name, "foo(bar).exe");
}

/// 中文名称匹配。
#[test]
fn search_matches_chinese_text() {
    let t = common::temp_db();
    add(&t, "测试工具.exe");
    add(&t, "画图.exe");
    let conn = t.db.get_conn();

    let hits = search_service::search_items(&conn, "测试", &[]).expect("chinese");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item.name, "测试工具.exe");
}

/// 文本 + 标签组合：两条件同时收敛。
#[test]
fn search_combines_text_and_tags() {
    let t = common::temp_db();
    let editor = add(&t, "Editor.exe");
    let viewer = add(&t, "Viewer.exe");
    let conn = t.db.get_conn();
    let dev = tag_service::add_tag(&conn, "dev", "#fff").unwrap();
    tag_service::set_item_tags(&conn, editor, &[dev.id]).unwrap();
    tag_service::set_item_tags(&conn, viewer, &[dev.id]).unwrap();

    // dev 标签下再按名称 "Editor" 收敛 → 仅 Editor。
    let hits = search_service::search_items(&conn, "Editor", &[dev.id]).expect("text+tags");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].item.name, "Editor.exe");
}

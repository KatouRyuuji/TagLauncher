//! 集成测试：官方主题切家族时的批量色位写回。
//! 覆盖读回一致、非法 hex 整批拒绝且不部分提交。

mod common;

use tag_launcher_lib::services::{cabinet_service, recolor_service, tag_service};
use tag_launcher_lib::services::recolor_service::RecolorPatch;

#[test]
fn recolor_batch_writes_and_reads_back() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    let tag_a = tag_service::add_tag(&conn, "开发", "#3b82f6").expect("add tag a");
    let tag_b = tag_service::add_tag(&conn, "娱乐", "#ec4899").expect("add tag b");
    let cab = cabinet_service::add_cabinet(&conn, "工作必备", "#22c55e").expect("add cabinet");

    recolor_service::recolor_tags_and_cabinets(
        &conn,
        &[
            RecolorPatch {
                id: tag_a.id,
                color: "#5064d8",
            },
            RecolorPatch {
                id: tag_b.id,
                color: "#8f5fc5",
            },
        ],
        &[RecolorPatch {
            id: cab.id,
            color: "#242424",
        }],
    )
    .expect("recolor");

    let tags = tag_service::get_tags(&conn).expect("get tags");
    let by_name: std::collections::HashMap<_, _> = tags
        .into_iter()
        .map(|tag| (tag.name, tag.color))
        .collect();
    assert_eq!(by_name.get("开发").map(String::as_str), Some("#5064d8"));
    assert_eq!(by_name.get("娱乐").map(String::as_str), Some("#8f5fc5"));

    let cabinets = cabinet_service::get_cabinets(&conn).expect("get cabinets");
    assert_eq!(cabinets.len(), 1);
    assert_eq!(cabinets[0].color, "#242424");
    assert_eq!(cabinets[0].name, "工作必备", "name 不得被色位写回改动");
}

#[test]
fn recolor_rejects_invalid_hex_without_partial_commit() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    let tag_a = tag_service::add_tag(&conn, "A", "#3b82f6").expect("add a");
    let tag_b = tag_service::add_tag(&conn, "B", "#ec4899").expect("add b");
    let cab = cabinet_service::add_cabinet(&conn, "柜", "#22c55e").expect("add cab");

    let err = recolor_service::recolor_tags_and_cabinets(
        &conn,
        &[
            RecolorPatch {
                id: tag_a.id,
                color: "#111111",
            },
            RecolorPatch {
                id: tag_b.id,
                color: "red",
            },
        ],
        &[RecolorPatch {
            id: cab.id,
            color: "#000000",
        }],
    )
    .expect_err("invalid hex must fail");
    assert!(
        err.contains("颜色格式无效"),
        "应提示 hex 非法: {err}"
    );

    let tags = tag_service::get_tags(&conn).unwrap();
    let by_name: std::collections::HashMap<_, _> = tags
        .into_iter()
        .map(|tag| (tag.name, tag.color))
        .collect();
    assert_eq!(by_name.get("A").map(String::as_str), Some("#3b82f6"));
    assert_eq!(by_name.get("B").map(String::as_str), Some("#ec4899"));
    assert_eq!(
        cabinet_service::get_cabinets(&conn).unwrap()[0].color,
        "#22c55e"
    );
}

#[test]
fn recolor_missing_id_rolls_back_earlier_writes() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    let tag_a = tag_service::add_tag(&conn, "A", "#3b82f6").expect("add a");

    let err = recolor_service::recolor_tags_and_cabinets(
        &conn,
        &[
            RecolorPatch {
                id: tag_a.id,
                color: "#111111",
            },
            RecolorPatch {
                id: 999_999,
                color: "#222222",
            },
        ],
        &[],
    )
    .expect_err("missing id must fail");
    assert!(err.contains("不存在"), "应提示标签不存在: {err}");

    let color: String = conn
        .query_row("SELECT color FROM tags WHERE id=?1", [tag_a.id], |r| r.get(0))
        .unwrap();
    assert_eq!(color, "#3b82f6", "事务回滚后先写入的行不得留下");
}

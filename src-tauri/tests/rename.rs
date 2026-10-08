//! 集成测试：对象重命名（真实临时文件）。
//! 覆盖磁盘与库内记录同步改名、不覆盖已存在目标、只改大小写、文件夹改名后子对象路径前缀、
//! dry_run 不动磁盘、失效与不存在对象被拒绝，以及改名后标签、备注、收藏与文件柜关系保留。

mod common;

use tag_launcher_lib::services::rename_service::{rename_items, RenameRequest};
use tag_launcher_lib::services::{cabinet_service, item_service, tag_service};

fn req(id: i64, new_name: &str) -> Vec<RenameRequest> {
    vec![RenameRequest { id, new_name: new_name.to_string() }]
}

fn db_path_name_type(t: &common::TestDb, id: i64) -> (String, String, String) {
    t.db.get_conn()
        .query_row("SELECT path, name, type FROM items WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
}

/// 改名后磁盘与库内记录一致，类型随扩展名更新，标签、备注、收藏与文件柜关系保留。
#[test]
fn rename_file_updates_disk_and_record_and_keeps_relations() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "旧名.exe", b"data");
    let id = {
        let conn = t.db.get_conn();
        let item = item_service::add_item(&conn, &path).unwrap();
        let tag = tag_service::add_tag(&conn, "工具", "#888888").unwrap();
        tag_service::set_item_tags(&conn, item.id, &[tag.id]).unwrap();
        item_service::set_item_note(&conn, item.id, "备注").unwrap();
        item_service::toggle_favorite(&conn, item.id).unwrap();
        let cabinet = cabinet_service::add_cabinet(&conn, "柜", "#888888").unwrap();
        cabinet_service::add_item_to_cabinet(&conn, cabinet.id, item.id).unwrap();
        item.id
    };

    let report = rename_items(&t.db, req(id, "新名.png"), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let new_path = t.dir.join("新名.png").to_string_lossy().to_string();
    assert_eq!(report.renamed.len(), 1);
    assert_eq!(report.renamed[0].new_path, new_path);
    assert!(!std::path::Path::new(&path).exists() && std::path::Path::new(&new_path).exists());

    let (db_path, name, item_type) = db_path_name_type(&t, id);
    assert_eq!((db_path.as_str(), name.as_str(), item_type.as_str()), (new_path.as_str(), "新名.png", "image"));
    let conn = t.db.get_conn();
    let got = item_service::get_item(&conn, id).unwrap();
    assert_eq!(got.tags.len(), 1);
    assert_eq!(got.item.note.as_deref(), Some("备注"));
    assert!(got.item.is_favorite);
    let cabinet_members: i64 = conn.query_row("SELECT COUNT(*) FROM cabinet_items WHERE item_id = ?1", [id], |r| r.get(0)).unwrap();
    assert_eq!(cabinet_members, 1);
}

/// 目标已存在：拒绝改名，两个文件内容与库内记录都不变；同名但大小写不同的另一个文件同样拒绝。
#[test]
fn rename_never_overwrites_existing_target() {
    let t = common::temp_db();
    let a = common::write_file(&t.dir, "a.txt", b"A");
    let b = common::write_file(&t.dir, "b.txt", b"B");
    let id = item_service::add_item(&t.db.get_conn(), &a).unwrap().id;

    for target in ["b.txt", "B.TXT"] {
        let report = rename_items(&t.db, req(id, target), false).unwrap();
        assert!(report.renamed.is_empty());
        assert_eq!(report.failed.len(), 1, "目标 {target} 应失败");
    }
    assert_eq!(std::fs::read(&a).unwrap(), b"A");
    assert_eq!(std::fs::read(&b).unwrap(), b"B");
    assert_eq!(db_path_name_type(&t, id).0, a);
}

/// 只改大小写的同一对象放行，磁盘与库内名称都更新。
#[test]
fn rename_case_only_is_allowed() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "case.txt", b"c");
    let id = item_service::add_item(&t.db.get_conn(), &path).unwrap().id;

    let report = rename_items(&t.db, req(id, "Case.TXT"), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let names: Vec<String> = std::fs::read_dir(&t.dir.path)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
        .collect();
    assert!(names.contains(&"Case.TXT".to_string()), "磁盘上应为新大小写：{names:?}");
    assert_eq!(db_path_name_type(&t, id).1, "Case.TXT");
}

/// 文件夹改名：库内子对象路径前缀同步替换，同名前缀的兄弟目录不受影响。
#[test]
fn rename_folder_updates_children_prefix_only() {
    let t = common::temp_db();
    let folder = common::make_dir(&t.dir, "ab");
    let child = common::write_file(&t.dir, "ab/sub/child.txt", b"x");
    let sibling = common::write_file(&t.dir, "abc/other.txt", b"y");
    let (folder_id, child_id, sibling_id) = {
        let conn = t.db.get_conn();
        (
            item_service::add_item(&conn, &folder).unwrap().id,
            item_service::add_item(&conn, &child).unwrap().id,
            item_service::add_item(&conn, &sibling).unwrap().id,
        )
    };

    let report = rename_items(&t.db, req(folder_id, "renamed"), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let new_folder = t.dir.join("renamed").to_string_lossy().to_string();
    let (folder_path, _, folder_type) = db_path_name_type(&t, folder_id);
    assert_eq!(folder_path, new_folder);
    assert_eq!(folder_type, "folder");
    let (child_path, child_name, _) = db_path_name_type(&t, child_id);
    assert_eq!(child_path, child.replacen(&folder, &new_folder, 1), "只替换前缀，其后的分隔符与子路径原样保留");
    assert_eq!(child_name, "child.txt");
    assert!(std::path::Path::new(&child_path).exists(), "子对象新路径在磁盘上存在");
    assert_eq!(db_path_name_type(&t, sibling_id).0, sibling, "兄弟目录不受影响");
}

/// dry_run 只返回计划：磁盘与库内不变；非法名称、名称未变分别进入失败与忽略。
#[test]
fn dry_run_reports_plan_without_side_effects() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "plan.txt", b"p");
    let id = item_service::add_item(&t.db.get_conn(), &path).unwrap().id;

    let report = rename_items(&t.db, req(id, "planned.txt"), true).unwrap();
    assert_eq!(report.renamed.len(), 1);
    assert!(std::path::Path::new(&path).exists());
    assert!(!t.dir.join("planned.txt").exists());
    assert_eq!(db_path_name_type(&t, id).0, path);

    let invalid = rename_items(&t.db, req(id, "a:b.txt"), true).unwrap();
    assert!(invalid.renamed.is_empty() && invalid.failed.len() == 1);
    let unchanged = rename_items(&t.db, req(id, "plan.txt"), false).unwrap();
    assert!(unchanged.renamed.is_empty() && unchanged.failed.is_empty(), "名称未变直接忽略");
}

/// 失效对象与不存在的 id 被拒绝，磁盘不变。
#[test]
fn rename_rejects_missing_and_unknown_items() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "gone.txt", b"g");
    let id = item_service::add_item(&t.db.get_conn(), &path).unwrap().id;
    t.db.get_conn().execute("UPDATE items SET is_missing = 1 WHERE id = ?1", [id]).unwrap();

    let report = rename_items(&t.db, vec![
        RenameRequest { id, new_name: "x.txt".into() },
        RenameRequest { id: 999_999, new_name: "y.txt".into() },
    ], false).unwrap();
    assert!(report.renamed.is_empty());
    assert_eq!(report.failed.len(), 2);
    assert!(std::path::Path::new(&path).exists());
}

//! 集成测试：对象重命名（真实临时文件）。
//! 覆盖磁盘与库内记录同步改名、不覆盖已存在目标、只改大小写、文件夹改名后子对象路径前缀、
//! dry_run 不动磁盘、失效与不存在对象被拒绝，以及改名后标签、备注、收藏与文件柜关系保留；
//! 批量改名覆盖互换、链式、成环、批内重名、部分失败与环内回退、文件夹与子对象同批、撤销还原和 1000 个对象的耗时抽样。

mod common;

use tag_launcher_lib::services::rename_service::{rename_items, RenameRequest};
use tag_launcher_lib::services::{cabinet_service, item_service, tag_service};

fn req(id: i64, new_name: &str) -> Vec<RenameRequest> {
    vec![RenameRequest { id, new_name: new_name.to_string() }]
}

fn reqs(pairs: &[(i64, &str)]) -> Vec<RenameRequest> {
    pairs.iter().map(|&(id, n)| RenameRequest { id, new_name: n.to_string() }).collect()
}

/// 在测试目录下建若干文件（内容为文件名本身）并加入库，返回各自的 id。
fn add_files(t: &common::TestDb, names: &[&str]) -> Vec<i64> {
    let conn = t.db.get_conn();
    names
        .iter()
        .map(|n| item_service::add_item(&conn, &common::write_file(&t.dir, n, n.as_bytes())).unwrap().id)
        .collect()
}

/// 断言 id 对应对象在库内名为 `name`，且磁盘上该名称的文件内容为 `content`。
fn assert_item(t: &common::TestDb, id: i64, name: &str, content: &str) {
    let (path, db_name, _) = db_path_name_type(t, id);
    assert_eq!(db_name, name);
    assert_eq!(path, t.dir.join(name).to_string_lossy().to_string());
    assert_eq!(std::fs::read(&path).unwrap(), content.as_bytes(), "{name} 的内容");
}

fn assert_no_temp_left(t: &common::TestDb) {
    let temps: Vec<String> = std::fs::read_dir(&t.dir.path)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
        .filter(|n| n.contains(".tl-") || n.starts_with("tl-"))
        .collect();
    assert!(temps.is_empty(), "不应残留临时名：{temps:?}");
}

/// 以不共享方式打开文件，模拟被其他程序占用。
fn lock(t: &common::TestDb, name: &str) -> std::fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().read(true).share_mode(0).open(t.dir.join(name)).unwrap()
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

/// 两个对象互换名称：内容随对象走，库内路径对调，不残留临时名。
#[test]
fn batch_swap_two_files() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt"]);
    let report = rename_items(&t.db, reqs(&[(ids[0], "b.txt"), (ids[1], "a.txt")]), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    assert_eq!(report.renamed.len(), 2);
    assert_item(&t, ids[0], "b.txt", "a.txt");
    assert_item(&t, ids[1], "a.txt", "b.txt");
    assert_no_temp_left(&t);
}

/// 链式改名 a→b、b→c：按依赖顺序执行，与请求顺序无关。
#[test]
fn batch_chain_runs_in_dependency_order() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt"]);
    let report = rename_items(&t.db, reqs(&[(ids[0], "b.txt"), (ids[1], "c.txt")]), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    assert_item(&t, ids[0], "b.txt", "a.txt");
    assert_item(&t, ids[1], "c.txt", "b.txt");
}

/// 三个对象成环 a→b→c→a 全部完成。
#[test]
fn batch_cycle_of_three() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt", "c.txt"]);
    let report = rename_items(&t.db, reqs(&[(ids[0], "b.txt"), (ids[1], "c.txt"), (ids[2], "a.txt")]), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    assert_item(&t, ids[0], "b.txt", "a.txt");
    assert_item(&t, ids[1], "c.txt", "b.txt");
    assert_item(&t, ids[2], "a.txt", "c.txt");
    assert_no_temp_left(&t);
}

/// 批内重名（不区分大小写）：先出现的执行，后出现的失败；目标被批外对象占用照常判为已存在。
#[test]
fn batch_duplicate_targets_and_outside_occupant() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt", "c.txt", "keep.txt"]);
    let report = rename_items(&t.db, reqs(&[(ids[0], "x.txt"), (ids[1], "X.TXT"), (ids[2], "keep.txt")]), false).unwrap();
    assert_eq!(report.renamed.iter().map(|r| r.id).collect::<Vec<_>>(), vec![ids[0]]);
    let errors: Vec<(i64, &str)> = report.failed.iter().map(|f| (f.id, f.error.as_str())).collect();
    assert!(errors.contains(&(ids[1], "与同批其他对象重名：「X.TXT」")), "{errors:?}");
    assert!(errors.contains(&(ids[2], "「keep.txt」已存在")), "{errors:?}");
    assert_item(&t, ids[2], "c.txt", "c.txt");
}

/// 部分失败：被占用的对象失败，其余照常完成；链中占用者失败时依赖它的对象不执行。
#[test]
fn batch_partial_failure_keeps_successes() {
    let t = common::temp_db();
    let ids = add_files(&t, &["free.txt", "locked.txt", "a.txt", "b.txt"]);
    let held = (lock(&t, "locked.txt"), lock(&t, "b.txt"));
    let report = rename_items(
        &t.db,
        reqs(&[(ids[0], "free2.txt"), (ids[1], "locked2.txt"), (ids[2], "b.txt"), (ids[3], "c.txt")]),
        false,
    )
    .unwrap();
    drop(held);
    assert_eq!(report.renamed.iter().map(|r| r.id).collect::<Vec<_>>(), vec![ids[0]]);
    assert_eq!(report.failed.len(), 3, "{:?}", report.failed);
    let blocked = report.failed.iter().find(|f| f.id == ids[2]).unwrap();
    assert_eq!(blocked.error, "「b.txt」被同批中改名失败的对象占用，未执行");
    assert_item(&t, ids[0], "free2.txt", "free.txt");
    assert_item(&t, ids[1], "locked.txt", "locked.txt");
    assert_item(&t, ids[2], "a.txt", "a.txt");
    assert_item(&t, ids[3], "b.txt", "b.txt");
}

/// 环中途失败：已完成的步骤按相反顺序改回，首个对象由临时名改回原名，磁盘与库内恢复原状。
#[test]
fn batch_cycle_failure_rolls_back() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt", "c.txt"]);
    let held = lock(&t, "b.txt");
    let report = rename_items(&t.db, reqs(&[(ids[0], "b.txt"), (ids[1], "c.txt"), (ids[2], "a.txt")]), false).unwrap();
    drop(held);
    assert!(report.renamed.is_empty(), "{:?}", report.renamed);
    assert_eq!(report.failed.len(), 3, "{:?}", report.failed);
    for f in &report.failed {
        if f.id != ids[1] {
            assert!(f.error.contains("已改回原名"), "{f:?}");
        }
    }
    assert_item(&t, ids[0], "a.txt", "a.txt");
    assert_item(&t, ids[1], "b.txt", "b.txt");
    assert_item(&t, ids[2], "c.txt", "c.txt");
    assert_no_temp_left(&t);
}

/// 文件夹与其中的对象同批改名：子对象先改，文件夹后改，库内子对象路径最终落在新文件夹下。
#[test]
fn batch_folder_and_child_together() {
    let t = common::temp_db();
    let folder = common::make_dir(&t.dir, "dir");
    let child = common::write_file(&t.dir, "dir/x.txt", b"x");
    let (folder_id, child_id) = {
        let conn = t.db.get_conn();
        (item_service::add_item(&conn, &folder).unwrap().id, item_service::add_item(&conn, &child).unwrap().id)
    };
    let report = rename_items(&t.db, reqs(&[(folder_id, "dir2"), (child_id, "y.txt")]), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let new_folder = t.dir.join("dir2").to_string_lossy().to_string();
    assert_eq!(db_path_name_type(&t, folder_id).0, new_folder);
    let (child_path, child_name, _) = db_path_name_type(&t, child_id);
    assert_eq!(child_name, "y.txt");
    assert!(child_path.starts_with(&new_folder) && child_path.ends_with("y.txt"), "{child_path}");
    assert_eq!(std::fs::read(&child_path).unwrap(), b"x");
}

/// 撤销：用各对象的原名再执行一次，磁盘与库内回到改名前（含互换）。
#[test]
fn batch_undo_restores_original_state() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt", "c.txt"]);
    let report = rename_items(&t.db, reqs(&[(ids[0], "b.txt"), (ids[1], "a.txt"), (ids[2], "c-new.txt")]), false).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    let undo = rename_items(&t.db, reqs(&[(ids[0], "a.txt"), (ids[1], "b.txt"), (ids[2], "c.txt")]), false).unwrap();
    assert!(undo.failed.is_empty(), "{:?}", undo.failed);
    assert_item(&t, ids[0], "a.txt", "a.txt");
    assert_item(&t, ids[1], "b.txt", "b.txt");
    assert_item(&t, ids[2], "c.txt", "c.txt");
    assert_no_temp_left(&t);
}

/// dry_run 对互换给出完整计划且不动磁盘。
#[test]
fn batch_dry_run_accepts_swap_without_side_effects() {
    let t = common::temp_db();
    let ids = add_files(&t, &["a.txt", "b.txt"]);
    let report = rename_items(&t.db, reqs(&[(ids[0], "b.txt"), (ids[1], "a.txt")]), true).unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    assert_eq!(report.renamed.len(), 2);
    assert_item(&t, ids[0], "a.txt", "a.txt");
    assert_item(&t, ids[1], "b.txt", "b.txt");
}

/// 耗时抽样：1000 个对象预检与执行全部成功，并输出耗时。
#[test]
fn batch_thousand_items_sample() {
    let t = common::temp_db();
    let names: Vec<String> = (0..1000).map(|i| format!("f{:04}.txt", i)).collect();
    let ids = add_files(&t, &names.iter().map(String::as_str).collect::<Vec<_>>());
    let targets: Vec<String> = (0..1000).map(|i| format!("renamed-{:04}.txt", i)).collect();
    let pairs: Vec<(i64, &str)> = ids.iter().copied().zip(targets.iter().map(String::as_str)).collect();

    let started = std::time::Instant::now();
    let plan = rename_items(&t.db, reqs(&pairs), true).unwrap();
    let dry = started.elapsed();
    assert_eq!(plan.renamed.len(), 1000);
    let started = std::time::Instant::now();
    let report = rename_items(&t.db, reqs(&pairs), false).unwrap();
    let run = started.elapsed();
    assert!(report.failed.is_empty(), "{:?}", report.failed.first());
    assert_eq!(report.renamed.len(), 1000);
    eprintln!("1000 个对象：预检 {:?}，执行 {:?}", dry, run);
}

//! 使用独立磁盘库验证大批量写入和列表读取的完整性，并输出热路径耗时。
mod common;

use tag_launcher_lib::services::{cabinet_service, item_service, tag_service};

#[test]
fn large_library_batch_paths() {
    let fixture = common::temp_db();
    let conn = fixture.db.get_conn();
    let tx = conn.unchecked_transaction().unwrap();
    {
        let mut insert = tx
            .prepare("INSERT INTO items (id, name, path, type) VALUES (?1, ?2, ?3, 'exe')")
            .unwrap();
        for id in 1..=5000 {
            insert
                .execute(rusqlite::params![
                    id,
                    format!("项目 {id}"),
                    format!("D:/Fixture/{id}.exe")
                ])
                .unwrap();
        }
        for id in 1..=10 {
            tx.execute(
                "INSERT INTO tags (id, name, color) VALUES (?1, ?2, '#5064d8')",
                rusqlite::params![id, format!("标签 {id}")],
            )
            .unwrap();
        }
    }
    tx.commit().unwrap();
    let changes = (1..=5000)
        .map(|id| (id, (1..=10).collect()))
        .collect::<Vec<_>>();
    let start = std::time::Instant::now();
    tag_service::set_many_item_tags(&conn, &changes).unwrap();
    let tagging = start.elapsed();
    let cabinet = cabinet_service::add_cabinet(&conn, "工作", "#5064d8").unwrap();
    let ids = (1..=5000).collect::<Vec<_>>();
    let start = std::time::Instant::now();
    cabinet_service::add_items_to_cabinet(&conn, cabinet.id, &ids).unwrap();
    let archiving = start.elapsed();
    let start = std::time::Instant::now();
    let items = item_service::get_items(&conn).unwrap();
    let reading = start.elapsed();
    assert_eq!(items.len(), 5000);
    assert!(items
        .iter()
        .all(|item| item.tags.iter().map(|tag| tag.id).eq(1..=10)));
    assert_eq!(
        cabinet_service::get_cabinet_items(&conn, cabinet.id)
            .unwrap()
            .len(),
        5000
    );
    eprintln!(
        "5000 objects, 10 tags each: tagging={tagging:?}, cabinet={archiving:?}, read={reading:?}"
    );
}

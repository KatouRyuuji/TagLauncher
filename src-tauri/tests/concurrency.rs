//! 集成测试：跨连接（等价于 GUI 与 tl 跨进程）并发写同一实库。
//! 回归 E2E test_concurrent_gui_and_cli_writes（30a15dd）：add_items 原用 DEFERRED 事务，
//! WAL 下先读后写遇他人已提交即 SQLITE_BUSY，不走 busy_timeout，整批报 "database is locked"。

mod common;

use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use tag_launcher_lib::db::Database;
use tag_launcher_lib::services::item_service;

/// 别的连接持写锁 1s：add_items 应在 BEGIN IMMEDIATE 处按 busy_timeout 排队，锁释放后整批成功。
#[test]
fn add_items_waits_for_foreign_write_lock() {
    let t = common::temp_db();
    let paths: Vec<String> = (0..5).map(|i| common::write_file(&t.dir, &format!("w{i}.txt"), b"x")).collect();
    let db_path = t.dir.db_path();
    let (locked_tx, locked_rx) = mpsc::channel();
    let holder = thread::spawn(move || {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE; UPDATE items SET name = name WHERE 0;").unwrap();
        locked_tx.send(()).unwrap();
        thread::sleep(Duration::from_millis(1000));
        conn.execute_batch("COMMIT").unwrap();
    });
    locked_rx.recv().unwrap();
    let t0 = Instant::now();
    let result = item_service::add_items(&t.db, paths);
    let waited = t0.elapsed();
    holder.join().unwrap();
    let errors: Vec<_> = result.failed.iter().map(|f| f.error.clone()).collect();
    assert!(errors.is_empty(), "持锁期间写入应排队而非失败：{errors:?}");
    assert_eq!(result.created_count, 5);
    assert!(waited >= Duration::from_millis(700), "应等到对方释放写锁，实际只等了 {waited:?}");
}

/// 多个独立连接同时分批 add_items：任何一批都不得因读快照过期而 "database is locked"。
#[test]
fn concurrent_add_items_from_separate_connections_all_land() {
    const WRITERS: usize = 4;
    const CHUNKS: usize = 6;
    const PER_CHUNK: usize = 10;
    let t = common::temp_db();
    let db_path = t.dir.db_path();
    let barrier = Arc::new(Barrier::new(WRITERS));
    let handles: Vec<_> = (0..WRITERS)
        .map(|w| {
            let paths: Vec<String> = (0..CHUNKS * PER_CHUNK)
                .map(|i| common::write_file(&t.dir, &format!("c{w}/f{i:03}.txt"), format!("{w}-{i}").as_bytes()))
                .collect();
            let db_path = db_path.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let db = Database::new(&db_path).expect("open second connection");
                barrier.wait();
                let mut failed = Vec::new();
                for chunk in paths.chunks(PER_CHUNK) {
                    let r = item_service::add_items(&db, chunk.to_vec());
                    failed.extend(r.failed.into_iter().map(|f| format!("{}: {}", f.path, f.error)));
                }
                failed
            })
        })
        .collect();
    let failed: Vec<String> = handles.into_iter().flat_map(|h| h.join().unwrap()).collect();
    assert!(failed.is_empty(), "并发写入出现失败（{} 项）：{:?}", failed.len(), &failed[..failed.len().min(5)]);
    let conn = t.db.get_conn();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(n as usize, WRITERS * CHUNKS * PER_CHUNK);
}

//! 集成测试：对象身份链路（真实临时文件）。
//! 覆盖真实文件 add 去重与身份捕获、改名后按身份重定位、惰性对账标记/清除失效、
//! 失效对象按签名找回的持久化原语（read_missing_signatures + apply_signature_relocations）。
//!
//! 说明：真正的"克隆盘身份冲突降级"（同 volume_serial+file_id 指向不同物理文件）无法在
//! 不 mock Win32 FFI 的前提下构造，其候选收集逻辑已由 item_service 单元测试（scan_dir_tree）覆盖；
//! 本文件覆盖可从集成层可达的身份行为。

mod common;

use tag_launcher_lib::services::{file_identity, item_service};

/// 真实文件加入后：若所在卷支持文件ID，则捕获身份（volume_serial 落库）；重复加入去重。
#[test]
fn add_real_file_captures_identity_and_dedups() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "ident.exe", b"hello");
    let conn = t.db.get_conn();

    let a = item_service::add_item(&conn, &path).expect("add 1");
    let b = item_service::add_item(&conn, &path).expect("add 2");
    assert_eq!(a.id, b.id, "同一真实文件应去重");

    // 若临时卷支持文件ID（NTFS），落库行应带上 volume_serial。
    if file_identity::get_identity(&path).is_some() {
        let vol: Option<i64> = conn
            .query_row("SELECT volume_serial FROM items WHERE id=?1", [a.id], |r| r.get(0))
            .unwrap();
        assert!(vol.is_some(), "NTFS 上应捕获并持久化卷序列号");
    } else {
        eprintln!("skip identity assertion: 临时目录文件系统不支持文件ID");
    }
}

/// 同一文件在磁盘上改名后，用新路径再次 add 应按文件身份归并到原记录（不产生重复行）。
#[test]
fn add_after_rename_dedups_by_identity() {
    let t = common::temp_db();
    let orig = common::write_file(&t.dir, "before.exe", b"payload");
    if file_identity::get_identity(&orig).is_none() {
        eprintln!("skip: 临时目录文件系统不支持文件ID");
        return;
    }
    let conn = t.db.get_conn();
    let a = item_service::add_item(&conn, &orig).expect("add original");

    // 磁盘上改名，再用新路径加入。
    let renamed = t.dir.join("after.exe");
    std::fs::rename(&orig, &renamed).expect("rename on disk");
    let renamed_str = renamed.to_string_lossy().to_string();
    let b = item_service::add_item(&conn, &renamed_str).expect("add renamed");

    assert_eq!(a.id, b.id, "改名后同一文件应按身份归并");
    let cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cnt, 1, "不应产生重复记录");
    // 记录已更新到最新路径与名称。
    let (name, is_missing): (String, i64) = conn
        .query_row("SELECT name, is_missing FROM items WHERE id=?1", [a.id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(name, "after.exe");
    assert_eq!(is_missing, 0);
}

/// 惰性对账：文件在原路径→保持有效并回填签名；文件被删且无法重定位→标记失效。
#[test]
fn reconcile_clears_then_marks_missing_on_real_file() {
    let t = common::temp_db();
    let path = common::write_file(&t.dir, "watched.exe", b"content-here");
    let conn = t.db.get_conn();
    let item = item_service::add_item(&conn, &path).expect("add");

    // 文件仍在 → 对账后不失效。
    item_service::reconcile_items(&conn).expect("reconcile 1");
    let missing1: i64 = conn
        .query_row("SELECT is_missing FROM items WHERE id=?1", [item.id], |r| r.get(0))
        .unwrap();
    assert_eq!(missing1, 0, "文件存在时不应失效");

    // 删除磁盘文件后再对账 → 无法定位 → 标记失效。
    std::fs::remove_file(&path).expect("delete file");
    item_service::reconcile_items(&conn).expect("reconcile 2");
    let missing2: i64 = conn
        .query_row("SELECT is_missing FROM items WHERE id=?1", [item.id], |r| r.get(0))
        .unwrap();
    assert_eq!(missing2, 1, "文件删除且无法重定位时应标记失效");
}

/// 按签名找回的持久化原语：读取"失效且有签名"的对象，回写命中的新路径并清除失效标记、刷新身份。
#[test]
fn signature_relocation_read_and_apply_roundtrip() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    // 造一个真实目标文件，取其签名，构造一条"失效且带该签名"的记录。
    let target = common::write_file(&t.dir, "recovered.bin", &vec![7u8; 20_000]);
    let sig = file_identity::compute_signature(&target).expect("signature of real file");
    conn.execute(
        "INSERT INTO items (name, path, type, is_missing, sig_size, sig_head, sig_tail) \
         VALUES ('recovered.bin', 'D:\\old\\recovered.bin', 'exe', 1, ?1, ?2, ?3)",
        rusqlite::params![sig.size as i64, sig.head_hash as i64, sig.tail_hash as i64],
    )
    .unwrap();
    let id = conn.last_insert_rowid();

    // 只读出"失效且有签名"的对象。
    let rows = item_service::read_missing_signatures(&conn).expect("read missing sigs");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, id);
    assert_eq!(rows[0].size, sig.size);

    // 回写命中的新路径：更新位置、清除失效、刷新签名/身份。
    let applied = item_service::apply_signature_relocations(&conn, &[(id, target.clone())])
        .expect("apply relocations");
    assert_eq!(applied, 1, "应成功回写 1 条");

    let (new_path, missing, new_sig): (String, i64, Option<i64>) = conn
        .query_row(
            "SELECT path, is_missing, sig_size FROM items WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(new_path, target, "路径应更新为找回的真实路径");
    assert_eq!(missing, 0, "找回后应清除失效标记");
    assert_eq!(new_sig, Some(sig.size as i64), "签名应刷新");
}

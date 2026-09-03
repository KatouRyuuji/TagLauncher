//! 集成测试：数据管理链路（真实文件库）。
//! 命令层（backup_data/export_data/import_data）绑定 Tauri State/AppHandle，不便直测；
//! 此处测其内部逻辑原语：在线快照、导出剔除敏感键并抹除明文、导入版本校验、
//! 覆盖与"从安全备份回滚"、数据目录重定向读写。

mod common;

use std::path::Path;

use tag_launcher_lib::db::Database;
use tag_launcher_lib::services::{item_service, path_service, settings_service};
use tag_launcher_lib::{
    overwrite_live_from, snapshot_live_db, strip_sensitive_keys, validate_importable_db,
};

/// 备份原语：把在线库整库快照到目标文件，目标可独立打开且数据完整。
#[test]
fn backup_snapshots_live_db_to_independent_file() {
    let t = common::temp_db();
    {
        let conn = t.db.get_conn();
        item_service::add_item(&conn, &common::write_file(&t.dir, "a.exe", b"a")).unwrap();
        item_service::add_item(&conn, &common::write_file(&t.dir, "b.exe", b"b")).unwrap();
    }
    let target = t.dir.join("backup.db");
    snapshot_live_db(&t.db, &target).expect("snapshot");

    // 目标库独立可读，数据完整。
    let copy = rusqlite::Connection::open(&target).unwrap();
    let cnt: i64 = copy.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(cnt, 2);
    let ver: i64 = copy
        .query_row("SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ver, i64::from(tag_launcher_lib::db::migrations::latest_schema_version()));
}

/// 导出原语：快照后剔除 ai.* 敏感键并 VACUUM——非敏感键保留，且明文密钥不残留于文件字节。
#[test]
fn export_strips_ai_keys_and_scrubs_plaintext() {
    let t = common::temp_db();
    const NEEDLE: &str = "sk-SECRET-NEEDLE-8Xq2z";
    {
        let conn = t.db.get_conn();
        settings_service::set_setting(&conn, "ai.api_key", NEEDLE).unwrap();
        settings_service::set_setting(&conn, "ai.base_url", "https://api.example.com").unwrap();
        settings_service::set_setting(&conn, "theme", "sakura").unwrap();
        item_service::add_item(&conn, &common::write_file(&t.dir, "keep.exe", b"a")).unwrap();
    }
    let target = t.dir.join("export.db");
    snapshot_live_db(&t.db, &target).expect("snapshot");
    strip_sensitive_keys(&target).expect("strip");

    {
        let copy = rusqlite::Connection::open(&target).unwrap();
        let ai_cnt: i64 = copy
            .query_row("SELECT COUNT(*) FROM app_meta WHERE key LIKE 'ai.%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ai_cnt, 0, "ai.* 敏感键应被剔除");
        let theme: String = copy
            .query_row("SELECT value FROM app_meta WHERE key='theme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(theme, "sakura", "非敏感键应保留");
        let items: i64 = copy.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 1, "对象数据应保留");
    }

    // VACUUM 重写文件后，密钥明文不应残留在文件字节中。
    let bytes = std::fs::read(&target).unwrap();
    assert!(
        !contains_subsequence(&bytes, NEEDLE.as_bytes()),
        "VACUUM 后密钥明文不应残留于导出文件"
    );
}

/// 导出原语（sync.* 凭据）：WebDAV 密码与 AI 密钥同为明文凭据，导出副本必须一并剔除，
/// 且 VACUUM 后密码明文不残留于文件字节（否则经分享出口外泄）。
#[test]
fn export_strips_sync_keys_and_scrubs_plaintext() {
    let t = common::temp_db();
    const NEEDLE: &str = "dav-SECRET-NEEDLE-P4ssw0rd";
    {
        let conn = t.db.get_conn();
        settings_service::set_setting(&conn, "sync.webdav_url", "https://dav.example.com").unwrap();
        settings_service::set_setting(&conn, "sync.username", "alice").unwrap();
        settings_service::set_setting(&conn, "sync.password", NEEDLE).unwrap();
        settings_service::set_setting(&conn, "theme", "dark").unwrap();
    }
    let target = t.dir.join("export_sync.db");
    snapshot_live_db(&t.db, &target).expect("snapshot");
    strip_sensitive_keys(&target).expect("strip");

    {
        let copy = rusqlite::Connection::open(&target).unwrap();
        let sync_cnt: i64 = copy
            .query_row("SELECT COUNT(*) FROM app_meta WHERE key LIKE 'sync.%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sync_cnt, 0, "sync.* 敏感键应被剔除");
        let theme: String = copy
            .query_row("SELECT value FROM app_meta WHERE key='theme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(theme, "dark", "非敏感键应保留");
    }

    // VACUUM 重写文件后，WebDAV 密码明文不应残留在文件字节中。
    let bytes = std::fs::read(&target).unwrap();
    assert!(
        !contains_subsequence(&bytes, NEEDLE.as_bytes()),
        "VACUUM 后 WebDAV 密码明文不应残留于导出文件"
    );
}

/// 导入版本校验：合法库返回其 schema_version；非 db / 缺 schema_version / 不存在均拒绝。
#[test]
fn validate_importable_db_accepts_valid_rejects_invalid() {
    let t = common::temp_db();

    // 合法的 TagLauncher 库（本测试自身的库快照）→ 返回版本 7。
    let good = t.dir.join("good.db");
    snapshot_live_db(&t.db, &good).expect("snapshot");
    assert_eq!(
        validate_importable_db(&good).unwrap(),
        tag_launcher_lib::db::migrations::latest_schema_version()
    );

    // 非 SQLite 文件 → 拒绝。
    let not_db = t.dir.join("not.db");
    std::fs::write(&not_db, b"definitely not a sqlite database").unwrap();
    assert!(validate_importable_db(&not_db).is_err());

    // 缺 schema_version 的 SQLite → 拒绝。
    let no_ver = t.dir.join("nover.db");
    {
        let c = rusqlite::Connection::open(&no_ver).unwrap();
        c.execute_batch("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);").unwrap();
    }
    assert!(validate_importable_db(&no_ver).is_err());

    // 不存在的文件 → 拒绝。
    assert!(validate_importable_db(Path::new("Z:/nope/missing.db")).is_err());
}

/// 导入覆盖与回滚原语：覆盖使实库变为来源内容；再从安全备份覆盖可回滚到导入前状态。
#[test]
fn import_overwrite_and_rollback_via_safety_backup() {
    let live = common::temp_db();
    // 实库初始状态 A：仅有 marker_A。
    {
        let conn = live.db.get_conn();
        item_service::add_item(&conn, &common::write_file(&live.dir, "marker_A.exe", b"a")).unwrap();
    }
    // 安全备份（导入前快照）。
    let safety = live.dir.join("safety.db");
    snapshot_live_db(&live.db, &safety).expect("safety snapshot");

    // 来源库 B：独立真实库，仅有 marker_B。
    let src = common::TempDir::new("importsrc");
    let src_path = src.db_path();
    {
        let src_db = Database::new(&src_path).unwrap();
        let conn = src_db.get_conn();
        item_service::add_item(&conn, &common::write_file(&src, "marker_B.exe", b"b")).unwrap();
    } // 关闭来源库连接（触发 WAL checkpoint 到主库文件）

    // 覆盖：实库 → 来源 B。
    overwrite_live_from(&live.db, &src_path).expect("overwrite from source");
    assert!(has_item_named(&live.db, "marker_B.exe"), "覆盖后应为来源内容 B");
    assert!(!has_item_named(&live.db, "marker_A.exe"), "原内容 A 应被覆盖");

    // 回滚：实库 → 安全备份（恢复 A）。
    overwrite_live_from(&live.db, &safety).expect("rollback from safety backup");
    assert!(has_item_named(&live.db, "marker_A.exe"), "回滚后应恢复到 A");
    assert!(!has_item_named(&live.db, "marker_B.exe"), "B 应被回滚移除");
}

/// 数据目录重定向读写：写入 datapath.json → 读回；清除 → 回退默认。
#[test]
fn data_directory_redirect_read_write() {
    let root = common::TempDir::new("root");
    let custom = common::TempDir::new("custom");

    // 初始无重定向文件。
    assert!(path_service::read_data_dir_redirect(&root.path).is_none());
    assert_eq!(path_service::default_save_dir(&root.path), root.path.join("Save"));

    // 写入自定义目录 → 读回一致。
    path_service::write_data_dir_redirect(&root.path, Some(&custom.path)).expect("write redirect");
    let read_back = path_service::read_data_dir_redirect(&root.path).expect("redirect present");
    assert_eq!(read_back, custom.path);

    // 清除（None）→ 文件移除，回退默认目录。
    path_service::write_data_dir_redirect(&root.path, None).expect("clear redirect");
    assert!(path_service::read_data_dir_redirect(&root.path).is_none());
}

// ── 辅助 ──────────────────────────────────────────────────────────────────

fn has_item_named(db: &Database, name: &str) -> bool {
    let conn = db.get_conn();
    conn.query_row("SELECT EXISTS(SELECT 1 FROM items WHERE name=?1)", [name], |r| {
        r.get::<_, i64>(0)
    })
    .map(|v| v != 0)
    .unwrap_or(false)
}

/// 朴素子序列（连续字节）查找：用于断言文件字节中不含某明文。
fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

//! 集成测试：云同步链路（真实文件库）与在线更新解析。
//! WebDAV 网络往返不在集成测试中发真实请求（无外部依赖原则）；
//! 此处测其数据原语：云端副本剔除敏感配置、恢复覆盖保留本机凭据的完整回路。

mod common;

use tag_launcher_lib::services::{item_service, settings_service};
use tag_launcher_lib::{
    overwrite_live_from, parse_release_response, read_local_secrets, reapply_local_secrets,
    snapshot_live_db, strip_cloud_secrets,
};

/// 云端副本剔除：ai.* 与 sync.* 全部移除、业务数据与普通设置保留、明文不残留于文件字节。
#[test]
fn cloud_copy_strips_ai_and_sync_secrets() {
    let t = common::temp_db();
    const AI_NEEDLE: &str = "sk-CLOUD-NEEDLE-3fXw9";
    const DAV_NEEDLE: &str = "dav-PASS-NEEDLE-7Qz1c";
    {
        let conn = t.db.get_conn();
        settings_service::set_setting(&conn, "ai.api_key", AI_NEEDLE).unwrap();
        settings_service::set_setting(&conn, "sync.password", DAV_NEEDLE).unwrap();
        settings_service::set_setting(&conn, "sync.webdav_url", "https://dav.example.com").unwrap();
        settings_service::set_setting(&conn, "theme", "sakura").unwrap();
        item_service::add_item(&conn, &common::write_file(&t.dir, "keep.exe", b"x")).unwrap();
    }

    let cloud = t.dir.join("cloud_copy.db");
    snapshot_live_db(&t.db, &cloud).expect("snapshot");
    strip_cloud_secrets(&cloud).expect("strip");

    {
        let copy = rusqlite::Connection::open(&cloud).unwrap();
        let secret_cnt: i64 = copy
            .query_row(
                "SELECT COUNT(*) FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(secret_cnt, 0, "云端副本不应含 ai.*/sync.* 键");
        let theme: String = copy
            .query_row("SELECT value FROM app_meta WHERE key='theme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(theme, "sakura", "普通设置应保留");
        let items: i64 = copy.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 1, "对象数据应保留");
    }

    // VACUUM 后明文不应残留在文件字节里
    let bytes = std::fs::read(&cloud).unwrap();
    for needle in [AI_NEEDLE, DAV_NEEDLE] {
        assert!(
            !contains_subsequence(&bytes, needle.as_bytes()),
            "明文 {} 不应残留于云端副本",
            needle
        );
    }
}

/// 恢复回路：用云端副本覆盖实库后，业务数据回到云端状态，但本机 ai.*/sync.* 凭据保留。
#[test]
fn restore_from_cloud_preserves_local_credentials() {
    let t = common::temp_db();
    // 1) 初始状态：一个对象 + 本机凭据
    {
        let conn = t.db.get_conn();
        item_service::add_item(&conn, &common::write_file(&t.dir, "a.exe", b"a")).unwrap();
        settings_service::set_setting(&conn, "ai.api_key", "local-ai-key").unwrap();
        settings_service::set_setting(&conn, "sync.webdav_url", "https://dav.local").unwrap();
        settings_service::set_setting(&conn, "sync.password", "local-dav-pass").unwrap();
    }

    // 2) 生成云端副本（剔除敏感配置）
    let cloud = t.dir.join("cloud.db");
    snapshot_live_db(&t.db, &cloud).expect("snapshot");
    strip_cloud_secrets(&cloud).expect("strip");

    // 3) 实库继续演化：加第二个对象、改凭据（模拟换密钥后想恢复旧数据）
    {
        let conn = t.db.get_conn();
        item_service::add_item(&conn, &common::write_file(&t.dir, "b.exe", b"b")).unwrap();
        settings_service::set_setting(&conn, "ai.api_key", "local-ai-key-v2").unwrap();
    }

    // 4) 恢复：保留本机凭据 → 覆盖 → 回填（与 sync_restore 命令同一原语序列）
    let secrets = read_local_secrets(&t.db);
    overwrite_live_from(&t.db, &cloud).expect("overwrite");
    reapply_local_secrets(&t.db, &secrets).expect("reapply");

    let conn = t.db.get_conn();
    let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(items, 1, "业务数据应回到云端副本状态（1 个对象）");

    let ai_key: String = conn
        .query_row("SELECT value FROM app_meta WHERE key='ai.api_key'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ai_key, "local-ai-key-v2", "本机 AI 密钥应保留恢复前的最新值");

    let dav_url: String = conn
        .query_row("SELECT value FROM app_meta WHERE key='sync.webdav_url'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(dav_url, "https://dav.local", "云同步配置应在恢复后继续可用");

    let dav_pass: String = conn
        .query_row("SELECT value FROM app_meta WHERE key='sync.password'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(dav_pass, "local-dav-pass", "云同步密码应保留");
}

/// 手动上传的未剔除副本：恢复时其内嵌凭据应被本机现值覆盖（本机优先）。
#[test]
fn restore_prefers_local_credentials_over_embedded_ones() {
    let t = common::temp_db();
    {
        let conn = t.db.get_conn();
        settings_service::set_setting(&conn, "ai.api_key", "local-key").unwrap();
    }

    // 云端副本未剔除（如用户手动放上去的完整备份），带着不同的密钥
    let cloud = t.dir.join("cloud_full.db");
    snapshot_live_db(&t.db, &cloud).expect("snapshot");
    {
        let copy = rusqlite::Connection::open(&cloud).unwrap();
        copy.execute(
            "UPDATE app_meta SET value='embedded-old-key' WHERE key='ai.api_key'",
            [],
        )
        .unwrap();
    }

    let secrets = read_local_secrets(&t.db);
    overwrite_live_from(&t.db, &cloud).expect("overwrite");
    reapply_local_secrets(&t.db, &secrets).expect("reapply");

    let conn = t.db.get_conn();
    let ai_key: String = conn
        .query_row("SELECT value FROM app_meta WHERE key='ai.api_key'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ai_key, "local-key", "本机凭据应覆盖云端副本内嵌值");
}

/// 更新解析：真实形态的 GitHub Release payload（字段齐全 + 干扰资产）。
#[test]
fn update_parse_handles_realistic_github_payload() {
    let payload = r###"{
        "url": "https://api.github.com/repos/KatouRyuuji/TagLauncher/releases/1",
        "tag_name": "v2.0.0",
        "name": "TagLauncher 2.0.0",
        "draft": false,
        "prerelease": false,
        "html_url": "https://github.com/KatouRyuuji/TagLauncher/releases/tag/v2.0.0",
        "body": "## What's New\n- Cloud sync",
        "assets": [
            {"name": "TagLauncher_2.0.0_x64-setup.exe.sig", "browser_download_url": "https://example.com/x64.sig", "size": 100},
            {"name": "TagLauncher_2.0.0_x64-setup.exe", "browser_download_url": "https://example.com/x64-setup.exe", "size": 9000000},
            {"name": "TagLauncher_2.0.0_arm64-setup.exe", "browser_download_url": "https://example.com/arm64-setup.exe", "size": 8500000}
        ]
    }"###;
    let info = parse_release_response(payload, "1.4.0").expect("parse");
    assert!(info.has_update);
    assert_eq!(info.latest_version, "2.0.0");
    // 当前架构（x86_64 或 aarch64）都应命中对应 -setup.exe 而非 .sig
    assert!(info.installer_url.ends_with("-setup.exe"));
    assert!(info.installer_size > 1_000_000);
}

fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

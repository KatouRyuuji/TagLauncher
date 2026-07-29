//! 集成测试：AI 配置存取契约 + 网络 SSRF 拦截。
//! AI 命令层（ai_get_config/ai_set_config）绑定 Tauri State，此处测其内部逻辑：
//! 三项已配置校验、下发前端时不泄露明文密钥。
//! 解析原语（build_endpoint/extract_text/parse_tag_list/base_url_is_insecure）为纯函数，
//! 已由 ai_commands 单元测试完整覆盖，不在集成层重复。
//! 网络层测 SSRF 判定谓词 is_disallowed_ip（内网拦截 / 公网放行 / IPv4-mapped 防绕过）。

mod common;

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use tag_launcher_lib::services::settings_service;
use tag_launcher_lib::{is_disallowed_ip, AiConfig};

/// is_configured：地址 + 密钥 + 模型三者均非空才算已配置。
#[test]
fn ai_is_configured_requires_all_three_fields() {
    let t = common::temp_db();
    let conn = t.db.get_conn();

    // 全空 → 未配置。
    assert!(!AiConfig::load(&conn).is_configured());

    // 仅地址 → 仍未配置。
    settings_service::set_setting(&conn, "ai.base_url", "https://api.example.com").unwrap();
    assert!(!AiConfig::load(&conn).is_configured());

    // 地址 + 密钥（缺模型）→ 仍未配置。
    settings_service::set_setting(&conn, "ai.api_key", "sk-xyz").unwrap();
    assert!(!AiConfig::load(&conn).is_configured());

    // 三项齐备 → 已配置。
    settings_service::set_setting(&conn, "ai.model", "claude-3-5-haiku").unwrap();
    assert!(AiConfig::load(&conn).is_configured());

    // 模型置空（仅空白）→ 回落未配置。
    settings_service::set_setting(&conn, "ai.model", "   ").unwrap();
    assert!(!AiConfig::load(&conn).is_configured());
}

/// 下发前端形态：清空明文密钥、仅保留 has_api_key 标志。
#[test]
fn ai_get_config_redacts_plaintext_key() {
    let t = common::temp_db();
    let conn = t.db.get_conn();
    settings_service::set_setting(&conn, "ai.base_url", "https://api.example.com").unwrap();
    settings_service::set_setting(&conn, "ai.model", "some-model").unwrap();
    settings_service::set_setting(&conn, "ai.api_key", "sk-super-secret").unwrap();

    // 后端内部载入含明文密钥（供 test_connection / suggest_tags 使用）。
    let internal = AiConfig::load(&conn);
    assert_eq!(internal.api_key, "sk-super-secret", "后端内部应能读到明文密钥");

    // 下发前端的形态：密钥清空、has_api_key=true。
    let sent = AiConfig::load(&conn).redacted_for_frontend();
    assert!(sent.api_key.is_empty(), "下发前端不得携带明文密钥");
    assert!(sent.has_api_key, "应告知前端已配置密钥");

    // 未配置密钥时：has_api_key=false。
    settings_service::set_setting(&conn, "ai.api_key", "").unwrap();
    let sent_empty = AiConfig::load(&conn).redacted_for_frontend();
    assert!(sent_empty.api_key.is_empty());
    assert!(!sent_empty.has_api_key, "无密钥时 has_api_key 应为 false");
}

/// SSRF：内网 / 环回 / 链路本地 / 保留段拦截；公网放行；IPv4-mapped 按其 IPv4 判定防绕过。
#[test]
fn ssrf_blocks_internal_allows_public() {
    // 应拦截。
    for ip in [
        IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),   // 环回
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5)),    // 私网 10/8
        IpAddr::V4(Ipv4Addr::new(172, 16, 3, 4)),  // 私网 172.16/12
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)), // 私网 192.168/16
        IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)), // 云元数据（链路本地）
        IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),  // CGNAT 100.64/10
        IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),     // 未指定
        IpAddr::V6(Ipv6Addr::LOCALHOST),           // ::1
        IpAddr::V6("::ffff:127.0.0.1".parse::<Ipv6Addr>().unwrap()), // IPv4-mapped 环回
        IpAddr::V6("fe80::1".parse::<Ipv6Addr>().unwrap()),          // 链路本地
        IpAddr::V6("fc00::1".parse::<Ipv6Addr>().unwrap()),          // 唯一本地
    ] {
        assert!(is_disallowed_ip(&ip), "应拦截内网/保留地址: {}", ip);
    }

    // 应放行。
    for ip in [
        IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
        IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        IpAddr::V6("2606:4700:4700::1111".parse::<Ipv6Addr>().unwrap()),
    ] {
        assert!(!is_disallowed_ip(&ip), "应放行公网地址: {}", ip);
    }
}

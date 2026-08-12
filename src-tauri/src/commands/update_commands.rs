// ============================================================================
// update_commands.rs — 在线更新检查（GitHub Releases）
// ============================================================================
// 设计要点：
// - 只做「检查 + 引导下载」，不做静默自更新：NSIS 安装包由用户确认后经浏览器
//   下载安装，避免引入更新签名密钥管理与后台替换二进制的攻击面（轻量定位）。
// - 数据源为 GitHub Releases API 的 /releases/latest（语义上已排除草稿与预发布）。
// - 网络失败/限流不影响主流程：命令返回 Err，前端静默降级（启动自动检查场景）。
// ============================================================================

use crate::extensions::mod_loader;
use crate::services::settings_service;
use std::io::Read;

/// 更新源仓库（owner/repo）。
const GITHUB_REPO: &str = "KatouRyuuji/TagLauncher";
/// GitHub API 响应大小上限（Release 描述 + 资产列表远小于此）。
const MAX_API_RESPONSE_BYTES: u64 = 2 * 1_048_576;

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 当前运行版本（来自 Cargo 包版本）
    pub current_version: String,
    /// 远端最新版本（已去除 v 前缀）
    pub latest_version: String,
    /// 是否存在更新（latest > current）
    pub has_update: bool,
    /// Release 页面 URL（引导用户浏览器下载）
    pub release_url: String,
    /// 发布说明（原始 Markdown，前端截断展示）
    pub release_notes: String,
    /// 匹配当前架构的安装包直链（找不到时为空，回退 release_url）
    pub installer_url: String,
    /// 安装包字节数（无匹配资产时为 0）
    pub installer_size: u64,
}

/// 检查 GitHub Releases 上是否有新版本。
/// 同步阻塞 HTTP，用 (async) 放到工作线程执行；不触碰数据库锁。
#[tauri::command(async)]
pub fn update_check() -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);
    let resp = ureq::AgentBuilder::new()
        .build()
        .get(&url)
        // GitHub API 要求 User-Agent，否则 403
        .set("User-Agent", &format!("TagLauncher/{}", settings_service::get_app_version()))
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => "仓库尚未发布任何 Release".to_string(),
            ureq::Error::Status(403, _) | ureq::Error::Status(429, _) => {
                "GitHub API 请求受限（稍后再试）".to_string()
            }
            other => format!("检查更新失败: {}", other),
        })?;

    let mut body = String::new();
    resp.into_reader()
        .take(MAX_API_RESPONSE_BYTES)
        .read_to_string(&mut body)
        .map_err(|e| format!("读取更新信息失败: {}", e))?;

    parse_release_response(&body, settings_service::get_app_version())
}

/// 解析 GitHub Release JSON，与当前版本比较。
/// 独立纯函数便于单元测试（不发真实网络请求）。
pub fn parse_release_response(json: &str, current_version: &str) -> Result<UpdateInfo, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("更新信息格式错误: {}", e))?;

    let tag = value["tag_name"].as_str().unwrap_or("").trim();
    if tag.is_empty() {
        return Err("更新信息缺少版本号（tag_name）".to_string());
    }
    // 兼容 "v1.4.0" 与 "1.4.0" 两种 tag 风格
    let latest = tag.trim_start_matches(['v', 'V']).to_string();

    let release_url = value["html_url"].as_str().unwrap_or("").to_string();
    let release_notes = value["body"].as_str().unwrap_or("").to_string();

    // has_update = current < latest
    let has_update = !mod_loader::semver_gte(current_version, &latest);

    let (installer_url, installer_size) = pick_installer_asset(
        value["assets"].as_array().map(|v| v.as_slice()).unwrap_or(&[]),
        std::env::consts::ARCH,
    );

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest,
        has_update,
        release_url,
        release_notes,
        installer_url,
        installer_size,
    })
}

/// 从 Release 资产列表中挑选匹配当前架构的 Windows 安装包。
/// tauri NSIS 产物命名形如 `TagLauncher_1.4.0_x64-setup.exe` / `..._arm64-setup.exe`。
/// 优先精确匹配架构后缀；不认识的架构或找不到时回退第一个 .exe 资产。
fn pick_installer_asset(assets: &[serde_json::Value], arch: &str) -> (String, u64) {
    let arch_token = match arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let wanted_suffix = format!("_{}-setup.exe", arch_token);

    let mut fallback: Option<(&str, u64)> = None;
    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        let url = asset["browser_download_url"].as_str().unwrap_or("");
        let size = asset["size"].as_u64().unwrap_or(0);
        if url.is_empty() {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(&wanted_suffix) {
            return (url.to_string(), size);
        }
        if lower.ends_with(".exe") && fallback.is_none() {
            fallback = Some((url, size));
        }
    }
    fallback
        .map(|(u, s)| (u.to_string(), s))
        .unwrap_or((String::new(), 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_release(tag: &str) -> String {
        format!(
            r###"{{
                "tag_name": "{tag}",
                "html_url": "https://github.com/KatouRyuuji/TagLauncher/releases/tag/{tag}",
                "body": "## 新特性 - WebDAV 云同步",
                "assets": [
                    {{"name": "TagLauncher_9.9.9_arm64-setup.exe", "browser_download_url": "https://example.com/arm64.exe", "size": 111}},
                    {{"name": "TagLauncher_9.9.9_x64-setup.exe", "browser_download_url": "https://example.com/x64.exe", "size": 222}}
                ]
            }}"###
        )
    }

    #[test]
    fn detects_newer_version_with_v_prefix() {
        let info = parse_release_response(&sample_release("v9.9.9"), "1.4.0").unwrap();
        assert!(info.has_update);
        assert_eq!(info.latest_version, "9.9.9");
        assert_eq!(info.current_version, "1.4.0");
    }

    #[test]
    fn same_or_older_version_is_not_update() {
        let info = parse_release_response(&sample_release("1.4.0"), "1.4.0").unwrap();
        assert!(!info.has_update);
        let info = parse_release_response(&sample_release("1.3.0"), "1.4.0").unwrap();
        assert!(!info.has_update);
    }

    #[test]
    fn picks_arch_matching_installer() {
        let json: serde_json::Value =
            serde_json::from_str(&sample_release("2.0.0")).unwrap();
        let assets = json["assets"].as_array().unwrap().as_slice();

        let (url, size) = pick_installer_asset(assets, "x86_64");
        assert_eq!(url, "https://example.com/x64.exe");
        assert_eq!(size, 222);

        let (url, size) = pick_installer_asset(assets, "aarch64");
        assert_eq!(url, "https://example.com/arm64.exe");
        assert_eq!(size, 111);
    }

    #[test]
    fn falls_back_to_first_exe_for_unknown_arch() {
        let json: serde_json::Value =
            serde_json::from_str(&sample_release("2.0.0")).unwrap();
        let assets = json["assets"].as_array().unwrap().as_slice();
        let (url, _) = pick_installer_asset(assets, "riscv64");
        assert_eq!(url, "https://example.com/arm64.exe");
    }

    #[test]
    fn missing_tag_name_is_error() {
        assert!(parse_release_response(r#"{"assets": []}"#, "1.0.0").is_err());
        assert!(parse_release_response("not json", "1.0.0").is_err());
    }

    #[test]
    fn no_assets_falls_back_to_release_page() {
        let info = parse_release_response(
            r#"{"tag_name": "2.0.0", "html_url": "https://x", "body": "", "assets": []}"#,
            "1.0.0",
        )
        .unwrap();
        assert!(info.has_update);
        assert_eq!(info.installer_url, "");
        assert_eq!(info.installer_size, 0);
        assert_eq!(info.release_url, "https://x");
    }
}

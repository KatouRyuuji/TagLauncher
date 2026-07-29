// ============================================================================
// ai_commands.rs — Anthropic 协议 AI 自动打标
// ============================================================================
// 设计要点：
// - 兼容 Anthropic Messages API（官方端点或任何兼容协议的第三方地址）。
// - 配置（base_url / api_key / model / 开关）存于 app_meta KV，键名前缀 "ai."。
// - 后端只负责"给一个对象建议标签"这一无状态原语（ai_suggest_tags），
//   批量遍历、并发控制、进度与应用标签由前端编排（KISS：进度/取消在 UI 侧最自然）。
// - HTTP 用 ureq（阻塞），与 net_fetch 一致，不引入 async 运行时。
// ============================================================================

use crate::db::Database;
use crate::services::settings_service::{get_setting, set_setting};
use rusqlite::Connection;
use std::io::Read;
use tauri::State;

// ---- 配置键 ----
const KEY_BASE_URL: &str = "ai.base_url";
const KEY_API_KEY: &str = "ai.api_key";
const KEY_MODEL: &str = "ai.model";
const KEY_AUTO_ON_ADD: &str = "ai.auto_tag_on_add";
const KEY_MAX_TAGS: &str = "ai.max_tags";
const KEY_ALLOW_NEW: &str = "ai.allow_new_tags";
const KEY_EXTRA_PROMPT: &str = "ai.extra_prompt";

const DEFAULT_MAX_TAGS: u32 = 5;
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub base_url: String,
    /// 写入方向（ai_set_config）：明文密钥；**留空表示"不修改已存密钥"**。
    /// 读取方向（ai_get_config）：恒为空，明文密钥不下发前端。
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    pub auto_tag_on_add: bool,
    pub max_tags: u32,
    pub allow_new_tags: bool,
    pub extra_prompt: String,
    /// 仅读取方向有意义：后端是否已存有密钥（供前端显示"已配置"）。写入方向忽略此字段。
    #[serde(default)]
    pub has_api_key: bool,
}

impl AiConfig {
    /// 加载：返回**含明文密钥**的完整配置，仅供后端自身使用
    /// （ai_test_connection / ai_suggest_tags / is_configured）。切勿直接回传前端。
    /// pub 以便集成测试从 KV 存取层验证"三项已配置校验"与"密钥不下发"契约。
    pub fn load(conn: &Connection) -> Self {
        AiConfig {
            base_url: get_setting(conn, KEY_BASE_URL).unwrap_or_default(),
            api_key: get_setting(conn, KEY_API_KEY).unwrap_or_default(),
            model: get_setting(conn, KEY_MODEL).unwrap_or_default(),
            auto_tag_on_add: get_setting(conn, KEY_AUTO_ON_ADD).as_deref() == Some("1"),
            max_tags: get_setting(conn, KEY_MAX_TAGS)
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_MAX_TAGS),
            allow_new_tags: get_setting(conn, KEY_ALLOW_NEW).as_deref() != Some("0"),
            extra_prompt: get_setting(conn, KEY_EXTRA_PROMPT).unwrap_or_default(),
            has_api_key: false,
        }
    }

    /// 已配置 = 地址 + 密钥 + 模型三者均非空（模型改为用户必填，无内置默认）。
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
            && !self.api_key.trim().is_empty()
            && !self.model.trim().is_empty()
    }

    /// 转为下发前端的安全形态：清空明文密钥、仅保留"是否已配置密钥"标志。
    /// 从 ai_get_config 抽出为独立方法（行为不变），使"密钥不下发前端"契约可被集成测试直接验证。
    pub fn redacted_for_frontend(mut self) -> Self {
        self.has_api_key = !self.api_key.trim().is_empty();
        self.api_key = String::new();
        self
    }
}

#[tauri::command]
pub fn ai_get_config(db: State<Database>) -> AiConfig {
    let conn = db.get_conn();
    // 不向前端下发明文密钥：仅告知是否已配置，明文密钥只在后端内部使用。
    AiConfig::load(&conn).redacted_for_frontend()
}

#[tauri::command]
pub fn ai_set_config(db: State<Database>, config: AiConfig) -> Result<(), String> {
    // 安全：非 https 的 base_url 会让 API 密钥明文过网络；仅放行本机 http（localhost/回环）。
    if base_url_is_insecure(&config.base_url) {
        return Err(
            "出于安全，API 地址必须使用 https（本机 http://localhost 除外），避免密钥明文传输".to_string(),
        );
    }
    let conn = db.get_conn();
    set_setting(&conn, KEY_BASE_URL, config.base_url.trim())?;
    // 密钥留空 = 不修改：前端不再持有明文，回存整份配置时不能把已存密钥清空。
    let new_key = config.api_key.trim();
    if !new_key.is_empty() {
        set_setting(&conn, KEY_API_KEY, new_key)?;
    }
    // 模型由用户必填，无内置默认：原样写入（留空即空，由 is_configured/前端拦截）。
    set_setting(&conn, KEY_MODEL, config.model.trim())?;
    set_setting(&conn, KEY_AUTO_ON_ADD, if config.auto_tag_on_add { "1" } else { "0" })?;
    set_setting(&conn, KEY_MAX_TAGS, &config.max_tags.clamp(1, 20).to_string())?;
    set_setting(&conn, KEY_ALLOW_NEW, if config.allow_new_tags { "1" } else { "0" })?;
    set_setting(&conn, KEY_EXTRA_PROMPT, config.extra_prompt.trim())?;
    Ok(())
}

/// 是否已配置 AI（供前端判断是否走自动打标，不泄露 key）。
#[tauri::command]
pub fn ai_is_configured(db: State<Database>) -> bool {
    let conn = db.get_conn();
    AiConfig::load(&conn).is_configured()
}

/// 显式清除已保存的 API 密钥。
/// ai_set_config 的"密钥留空=不修改"语义下前端无法删除已存密钥，故提供独立清除通道。
#[tauri::command]
pub fn ai_clear_api_key(db: State<Database>) -> Result<(), String> {
    let conn = db.get_conn();
    set_setting(&conn, KEY_API_KEY, "")
}

/// 测试连接：发一条极简消息，成功返回模型回显文本。
/// 阻塞 HTTP，用 (async) 放到工作线程避免冻结 UI；DB 锁只在同步的 config 载入小段内持有并随即
/// 释放，之后的网络调用不持锁——函数体无 await，不存在跨 await 持锁。
#[tauri::command(async)]
pub fn ai_test_connection(db: State<Database>) -> Result<String, String> {
    let config = {
        let conn = db.get_conn();
        AiConfig::load(&conn)
    };
    if !config.is_configured() {
        return Err("请先填写 API 地址与密钥".to_string());
    }
    let reply = call_messages(
        &config,
        "You are a connection tester. Reply with the single word: ok",
        "ping",
        16,
    )?;
    Ok(reply.trim().to_string())
}

/// 为单个对象建议标签。existingTags 为当前全部标签词表（引导模型优先复用）。
/// 返回去重后的标签名列表（已按配置裁剪数量）。
/// 阻塞 HTTP，用 (async) 放到工作线程；DB 锁只在同步的 config 载入小段内持有并随即释放。
#[tauri::command(async)]
pub fn ai_suggest_tags(
    db: State<Database>,
    name: String,
    path: String,
    item_type: String,
    existing_tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let config = {
        let conn = db.get_conn();
        AiConfig::load(&conn)
    };
    if !config.is_configured() {
        return Err("AI 未配置".to_string());
    }

    let system = build_system_prompt(&config);
    let user = build_user_prompt(&name, &path, &item_type, &existing_tags);
    let reply = call_messages(&config, &system, &user, 512)?;
    let tags = parse_tag_list(&reply, config.max_tags as usize);
    Ok(tags)
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

fn build_system_prompt(config: &AiConfig) -> String {
    let policy = if config.allow_new_tags {
        "You may reuse tags from the provided vocabulary or invent new concise tags when clearly warranted."
    } else {
        "You MUST only choose tags from the provided vocabulary. Do not invent new tags."
    };
    let extra = if config.extra_prompt.trim().is_empty() {
        String::new()
    } else {
        format!("\nAdditional user guidance: {}", config.extra_prompt.trim())
    };
    format!(
        "You are a file-tagging assistant for a local file launcher. \
Given one object (file, folder, program, script, image or audio), propose up to {max} short, \
high-signal tags describing its category, purpose, technology, or project. \
Prefer Chinese tags when the object name is Chinese, otherwise short English/technical tags. \
{policy} \
Return ONLY a compact JSON array of tag strings, e.g. [\"开发工具\",\"截图\"]. No prose, no code fences.{extra}",
        max = config.max_tags,
        policy = policy,
        extra = extra,
    )
}

fn build_user_prompt(name: &str, path: &str, item_type: &str, existing_tags: &[String]) -> String {
    // 词表过长时截断，控制 token（个人库标签通常不多，这里给 300 上限兜底）
    let vocab: Vec<&str> = existing_tags.iter().map(|s| s.as_str()).take(300).collect();
    let vocab_str = if vocab.is_empty() {
        "(none yet)".to_string()
    } else {
        vocab.join(", ")
    };
    format!(
        "Object name: {name}\nType: {item_type}\nPath: {path}\n\nExisting tag vocabulary: {vocab}\n\nPropose tags now as a JSON array.",
        name = name,
        item_type = item_type,
        path = path,
        vocab = vocab_str,
    )
}

// ---------------------------------------------------------------------------
// HTTP：Anthropic Messages API
// ---------------------------------------------------------------------------

/// 归一化 base_url → 完整 messages 端点。
/// 兼容：".../v1/messages"（原样）、".../v1"（补 /messages）、其它（补 /v1/messages）。
fn build_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/messages") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/messages")
    } else {
        format!("{trimmed}/v1/messages")
    }
}

/// 判断 base_url 是否为「不安全的明文 http」：`http://` 且主机不是本机回环。
/// 空串（未配置）与 `https://` 均视为安全（不拦截）。
fn base_url_is_insecure(base_url: &str) -> bool {
    let rest = match base_url.trim().strip_prefix("http://") {
        Some(r) => r,
        None => return false, // https / 空 / 其它前缀：此处不拦
    };
    // host 可能是 `[::1]` 形式的 IPv6 字面量：须先剥离方括号再比对，
    // 否则按 ':' 切分得到的是 "["，本机回环端点会被误拦。
    let host = if let Some(after_bracket) = rest.strip_prefix('[') {
        after_bracket
            .split(']')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
    } else {
        rest.split(['/', ':', '?', '#'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
    };
    !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1")
}

fn call_messages(config: &AiConfig, system: &str, user: &str, max_tokens: u32) -> Result<String, String> {
    let endpoint = build_endpoint(&config.base_url);
    let body = serde_json::json!({
        "model": config.model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    });

    // redirects(0)：禁用自动重定向——ureq 跟随重定向时会携带原请求头（含 x-api-key）
    // 转发到新主机，被劫持/恶意的兼容网关可 302 把密钥引到第三方。改为显式报出重定向，
    // 由用户核对 base_url。（不做私网拦截：base_url 是用户自配，本地/局域网网关属合法场景。）
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let response = agent
        .post(&endpoint)
        .set("content-type", "application/json")
        // 收敛鉴权头：Anthropic 协议标准是 x-api-key；不再额外发送 Authorization: Bearer，
        // 避免把密钥暴露给会记录 Authorization 头的第三方兼容网关（缩小泄露面）。
        .set("x-api-key", config.api_key.trim())
        .set("anthropic-version", ANTHROPIC_VERSION)
        .timeout(std::time::Duration::from_secs(60))
        .send_string(&body.to_string());

    match response {
        Ok(resp) => {
            let status = resp.status();
            if (300..400).contains(&status) {
                return Err(format!(
                    "端点返回重定向（{}）。出于密钥安全不自动跟随，请检查 API 地址是否正确",
                    status
                ));
            }
            let mut buf = String::new();
            resp.into_reader()
                .take(4 * 1_048_576)
                .read_to_string(&mut buf)
                .map_err(|e| format!("读取响应失败: {}", e))?;
            extract_text(&buf)
        }
        Err(ureq::Error::Status(code, resp)) => {
            let detail = resp.into_string().unwrap_or_default();
            Err(format!("API 返回 {}：{}", code, truncate(&detail, 300)))
        }
        Err(e) => Err(format!("请求失败：{}", e)),
    }
}

/// 从 Anthropic 响应 JSON 提取首个文本块。
fn extract_text(raw: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("响应不是有效 JSON：{}", e))?;
    // Anthropic：{ content: [{type:"text", text:"..."}] }
    if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
        let mut out = String::new();
        for block in arr {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                    out.push_str(t);
                }
            }
        }
        if !out.is_empty() {
            return Ok(out);
        }
    }
    // 兜底：部分兼容网关用 OpenAI 风格 choices[].message.content
    if let Some(text) = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
    {
        return Ok(text.to_string());
    }
    Err("响应中未找到文本内容".to_string())
}

/// 从模型回复解析标签数组。优先解析 JSON 数组；失败时回退按行/逗号切分。
fn parse_tag_list(reply: &str, max: usize) -> Vec<String> {
    let cleaned = strip_code_fences(reply);

    // 尝试提取第一个 JSON 数组
    if let (Some(start), Some(end)) = (cleaned.find('['), cleaned.rfind(']')) {
        if end > start {
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(&cleaned[start..=end]) {
                return dedup_clean(arr, max);
            }
        }
    }

    // 回退：逗号或换行分隔
    let parts: Vec<String> = cleaned
        .split(|c| c == ',' || c == '\n' || c == '、')
        .map(|s| s.trim().trim_matches(['"', '\'', '[', ']', '-', '*', '#']).trim().to_string())
        .collect();
    dedup_clean(parts, max)
}

fn dedup_clean(tags: Vec<String>, max: usize) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for t in tags {
        let t = t.trim().to_string();
        // 按字符数而非字节数截断：中文 UTF-8 每字 3 字节，按字节会误杀合法中文长标签。
        if t.is_empty() || t.chars().count() > 40 {
            continue;
        }
        let key = t.to_lowercase();
        if seen.insert(key) {
            out.push(t);
            if out.len() >= max {
                break;
            }
        }
    }
    out
}

fn strip_code_fences(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```") {
        // 去掉可能的语言标识行
        let rest = rest.splitn(2, '\n').nth(1).unwrap_or(rest);
        return rest.trim_end_matches("```").trim().to_string();
    }
    t.to_string()
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_normalization() {
        assert_eq!(build_endpoint("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
        assert_eq!(build_endpoint("https://api.anthropic.com/"), "https://api.anthropic.com/v1/messages");
        assert_eq!(build_endpoint("https://x.com/v1"), "https://x.com/v1/messages");
        assert_eq!(build_endpoint("https://x.com/v1/messages"), "https://x.com/v1/messages");
    }

    #[test]
    fn parse_json_array() {
        let tags = parse_tag_list("[\"开发工具\", \"截图\", \"截图\"]", 5);
        assert_eq!(tags, vec!["开发工具", "截图"]);
    }

    #[test]
    fn parse_with_code_fence() {
        let tags = parse_tag_list("```json\n[\"a\", \"b\"]\n```", 5);
        assert_eq!(tags, vec!["a", "b"]);
    }

    #[test]
    fn parse_fallback_comma() {
        let tags = parse_tag_list("开发工具, 截图, 编辑器", 2);
        assert_eq!(tags, vec!["开发工具", "截图"]);
    }

    #[test]
    fn extract_anthropic_text() {
        let raw = r#"{"content":[{"type":"text","text":"[\"a\"]"}]}"#;
        assert_eq!(extract_text(raw).unwrap(), "[\"a\"]");
    }

    #[test]
    fn extract_openai_style_fallback() {
        let raw = r#"{"choices":[{"message":{"content":"[\"a\"]"}}]}"#;
        assert_eq!(extract_text(raw).unwrap(), "[\"a\"]");
    }

    #[test]
    fn insecure_base_url_only_blocks_non_local_http() {
        // 明文 http 到公网/域名 → 拦
        assert!(base_url_is_insecure("http://api.example.com"));
        assert!(base_url_is_insecure("http://8.8.8.8/v1"));
        // https / 本机 http / 空 → 放行
        assert!(!base_url_is_insecure("https://api.anthropic.com"));
        assert!(!base_url_is_insecure("http://localhost:8080/v1"));
        assert!(!base_url_is_insecure("http://127.0.0.1:1234"));
        // IPv6 回环字面量（带/不带端口、带路径）→ 放行（方括号须先剥离再比对）
        assert!(!base_url_is_insecure("http://[::1]:8080/v1"));
        assert!(!base_url_is_insecure("http://[::1]"));
        assert!(!base_url_is_insecure(""));
    }
}

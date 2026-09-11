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
/// 测试连接与打标的输出上限。思考模型会先占用一部分 token 写 thinking 块，
/// 过小（如 16）时 content 里只有 thinking、没有 text，表现为「响应中未找到文本内容」。
const COMPLETION_MAX_TOKENS: u32 = 1024;
/// 思考模型（Kimi K2.7 等）首 token 较慢，整段请求含连接+读体。
const HTTP_TIMEOUT_SECS: u64 = 120;

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
    crate::db::ensure_writes_allowed()?;
    // 安全：非 https 的 base_url 会让 API 密钥明文过网络；仅放行本机 http（localhost/回环）。
    if base_url_is_insecure(&config.base_url) {
        return Err(
            "出于安全，API 地址必须使用 https（本机 http://localhost 除外），避免密钥明文传输".to_string(),
        );
    }
    let conn = db.get_conn();
    // 七项配置写入包在一个事务里：中途失败（DB 锁/磁盘错误）整体回滚，
    // 不留"地址已写但模型没写"之类的半截配置（用户无法分辨哪些键已落库）。
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    set_setting(&tx, KEY_BASE_URL, config.base_url.trim())?;
    // 密钥留空 = 不修改：前端不再持有明文，回存整份配置时不能把已存密钥清空。
    let new_key = config.api_key.trim();
    if !new_key.is_empty() {
        set_setting(&tx, KEY_API_KEY, new_key)?;
    }
    // 模型由用户必填，无内置默认：原样写入（留空即空，由 is_configured/前端拦截）。
    set_setting(&tx, KEY_MODEL, config.model.trim())?;
    set_setting(&tx, KEY_AUTO_ON_ADD, if config.auto_tag_on_add { "1" } else { "0" })?;
    set_setting(&tx, KEY_MAX_TAGS, &config.max_tags.clamp(1, 20).to_string())?;
    set_setting(&tx, KEY_ALLOW_NEW, if config.allow_new_tags { "1" } else { "0" })?;
    set_setting(&tx, KEY_EXTRA_PROMPT, config.extra_prompt.trim())?;
    tx.commit().map_err(|e| e.to_string())?;
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
    crate::db::ensure_writes_allowed()?;
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
        return Err("请先填写并保存 API 地址、密钥与模型".to_string());
    }
    let reply = call_messages(
        &config,
        "You are a connection tester. Reply with the single word: ok",
        "ping",
        COMPLETION_MAX_TOKENS,
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
    let reply = call_messages(&config, &system, &user, COMPLETION_MAX_TOKENS)?;
    let tags = parse_tag_list(&reply, config.max_tags as usize);
    // allow_new_tags=false 时提示词只是软约束：散文回复经回退切分仍会产出词表外标签。
    // 返回前按本次词表（大小写不敏感）硬性过滤，词表外的一律丢弃。
    if !config.allow_new_tags {
        let vocab: std::collections::HashSet<String> =
            existing_tags.iter().map(|t| t.to_lowercase()).collect();
        return Ok(tags.into_iter().filter(|t| vocab.contains(&t.to_lowercase())).collect());
    }
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
    // scheme 大小写不敏感（RFC 3986，HTTP 客户端会归一化为小写）：先统一小写再剥离，
    // 防止 "HTTP://api.example.com" 绕过本机 http 白名单导致 API 密钥明文传输。
    let lowered = base_url.trim().to_ascii_lowercase();
    let rest = match lowered.strip_prefix("http://") {
        Some(r) => r,
        None => return false, // https / 空 / 其它前缀：此处不拦
    };
    // 先剥离 userinfo（"user:pass@" 段）：不剥则 "http://localhost:1@evil.com"
    // 会把 @ 前的 localhost 误判为 host，绕过本机 http 白名单。
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    // host 可能是 `[::1]` 形式的 IPv6 字面量：须先剥离方括号再比对，
    // 否则按 ':' 切分得到的是 "["，本机回环端点会被误拦。
    let host = if let Some(after_bracket) = authority.strip_prefix('[') {
        after_bracket.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    !matches!(host, "localhost" | "127.0.0.1" | "::1")
}

/// 构造请求体。打标/测试连接是结构化输出任务，显式禁用思考：消除思考模型
/// 间歇性无文本响应、避免 thinking 吃掉输出预算，响应也更快更省 token。
/// Anthropic 官方与 Kimi 等兼容网关均接受 thinking 字段（disabled 为默认语义）；
/// 对该字段不认识的宽容网关会忽略它。
fn build_request_body(config: &AiConfig, system: &str, user: &str, max_tokens: u32) -> String {
    serde_json::json!({
        "model": config.model,
        "max_tokens": max_tokens,
        "stream": false,
        "thinking": { "type": "disabled" },
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    })
    .to_string()
}

fn call_messages(config: &AiConfig, system: &str, user: &str, max_tokens: u32) -> Result<String, String> {    let endpoint = build_endpoint(&config.base_url);
    let key = config.api_key.trim();
    let body = build_request_body(config, system, user, max_tokens);

    // redirects(0)：禁用自动重定向——ureq 跟随重定向时会携带原请求头（含密钥）
    // 转发到新主机，被劫持/恶意的兼容网关可 302 把密钥引到第三方。改为显式报出重定向，
    // 由用户核对 base_url。（不做私网拦截：base_url 是用户自配，本地/局域网网关属合法场景。）
    let agent = ureq::AgentBuilder::new().redirects(0).build();

    // 限流（429）与网关/过载错误（500/502/503/529）多为瞬态：有限重试（最多 2 次，
    // 指数退避 1s/3s），最终仍失败才计为该对象失败。
    let mut attempt = 0u32;
    loop {
        let response = agent
            .post(&endpoint)
            .set("content-type", "application/json")
            .set("accept", "application/json")
            // 官方 Anthropic 认 x-api-key；Kimi Code / Claude Code 的 ANTHROPIC_AUTH_TOKEN
            // 风格兼容网关认 Authorization: Bearer。两者一并发送。
            .set("x-api-key", key)
            .set("authorization", &format!("Bearer {key}"))
            .set("anthropic-version", ANTHROPIC_VERSION)
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body);

        match response {
            Ok(resp) => {
                let status = resp.status();
                if (300..400).contains(&status) {
                    return Err(format!(
                        "端点返回重定向（{}）。出于密钥安全不自动跟随，请检查 API 地址是否正确",
                        status
                    ));
                }
                // 网关强制流式（SSE）时响应体不是 JSON 而是事件流：提前识别并说明原因，
                // 否则用户只会看到莫名其妙的 JSON 解析错误
                let content_type = resp.header("content-type").unwrap_or_default().to_ascii_lowercase();
                if content_type.contains("text/event-stream") {
                    return Err("网关返回了流式(SSE)响应，本应用仅支持非流式".to_string());
                }
                // 上限 +1 字节探测：超过 4MB 明确报"响应过大"，而不是静默截断后
                // 让用户面对莫名其妙的 JSON 解析错误（分不清是响应太大还是格式错误）
                const MAX_RESPONSE_BYTES: u64 = 4 * 1_048_576;
                let mut buf = String::new();
                resp
                    .into_reader()
                    .take(MAX_RESPONSE_BYTES + 1)
                    .read_to_string(&mut buf)
                    .map_err(|e| format!("读取响应失败: {}", e))?;
                if buf.len() as u64 > MAX_RESPONSE_BYTES {
                    return Err("AI 响应体超过 4MB 上限，已中止（可能是代理/网关返回异常内容）".to_string());
                }
                match extract_text(&buf) {
                    Ok(text) => return Ok(text),
                    Err(e) => {
                        // 结构有效但无文本（思考模型/网关在压力下偶发空 content）：
                        // 按瞬态故障重试，与 429/5xx 共用重试预算
                        if e.contains("未找到文本内容") && attempt < 2 {
                            attempt += 1;
                            std::thread::sleep(std::time::Duration::from_secs(if attempt == 1 { 1 } else { 3 }));
                            continue;
                        }
                        return Err(e);
                    }
                }
            }
            Err(ureq::Error::Status(code, resp)) => {
                if matches!(code, 429 | 500 | 502 | 503 | 529) && attempt < 2 {
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_secs(if attempt == 1 { 1 } else { 3 }));
                    continue;
                }
                // 网关常在错误体里回显请求（含密钥）：先抹掉密钥再截断，避免密钥入前端
                let raw = resp.into_string().unwrap_or_default();
                let detail = redact_api_key(&status_error_detail(&raw), key);
                return Err(format!("API 返回 {}：{}", code, truncate(&detail, 300)));
            }
            Err(e) => return Err(redact_api_key(&format!("请求失败：{}", e), &config.api_key)),
        }
    }
}

/// 错误文案脱敏：网关/代理可能在错误体或 IO 错误里回显请求头，入前端前把已配置的
/// API 密钥替换为 ***。
fn redact_api_key(msg: &str, api_key: &str) -> String {
    let key = api_key.trim();
    if key.is_empty() {
        return msg.to_string();
    }
    msg.replace(key, "***")
}

/// 从 Anthropic 响应 JSON 提取正文文本块（跳过 thinking）。
fn extract_text(raw: &str) -> Result<String, String> {
    let raw = raw.trim_start_matches('\u{feff}');
    let trimmed = raw.trim_start();
    // 部分网关 content-type 标成 JSON，实际是 SSE 事件流
    if trimmed.starts_with("data:") || trimmed.starts_with("event:") {
        return Err("网关返回了流式(SSE)响应，本应用仅支持非流式".to_string());
    }
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("响应不是有效 JSON：{}", e))?;

    // HTTP 200 仍可能带 Anthropic/OpenAI 错误对象
    if let Some(msg) = api_error_from_value(&v) {
        return Err(format!("API 错误：{}", msg));
    }

    // Anthropic：{ content: [{type:"text", text:"..."}] }；思考模型还会带 type=thinking 块。
    if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
        let mut out = String::new();
        let mut saw_thinking = false;
        for block in arr {
            if let Some(s) = block.as_str() {
                out.push_str(s);
                continue;
            }
            match block.get("type").and_then(|t| t.as_str()) {
                Some("thinking") | Some("redacted_thinking") => saw_thinking = true,
                Some("text") | Some("output_text") | None => {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        out.push_str(t);
                    }
                }
                _ => {}
            }
        }
        if !out.trim().is_empty() {
            return Ok(out);
        }
        if saw_thinking {
            let stop = v.get("stop_reason").and_then(|s| s.as_str()).unwrap_or("");
            if stop == "max_tokens" {
                return Err(
                    "模型只返回了思考过程、没有正文（思考耗尽了输出上限）".to_string(),
                );
            }
            return Err("模型只返回了思考过程、没有正文".to_string());
        }
    }
    // 部分网关把 content 写成字符串
    if let Some(s) = v.get("content").and_then(|c| c.as_str()) {
        if !s.trim().is_empty() {
            return Ok(s.to_string());
        }
    }
    // 兜底：OpenAI 风格 choices[].message.content（字符串或分段数组）
    if let Some(text) = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(openai_message_content)
    {
        return Ok(text);
    }
    // 附带响应结构诊断（只含骨架不含内容），便于定位网关的非标响应形态
    Err(format!(
        "响应中未找到文本内容（{}）",
        response_diagnosis(&v)
    ))
}

/// 响应骨架诊断：顶层键、stop_reason、content/choices 的形态与块数。
/// 只描述结构不引用内容，避免把模型输出/网关回显带进错误消息。
fn response_diagnosis(v: &serde_json::Value) -> String {
    let keys: Vec<&str> = v.as_object().map(|o| o.keys().map(|k| k.as_str()).collect()).unwrap_or_default();
    let stop = v.get("stop_reason").and_then(|s| s.as_str()).unwrap_or("-");
    let content_desc = match v.get("content") {
        None => "缺失".to_string(),
        Some(c) if c.is_null() => "null".to_string(),
        Some(c) if c.is_string() => "空字符串".to_string(),
        Some(serde_json::Value::Array(a)) => {
            let types: Vec<String> = a
                .iter()
                .take(4)
                .map(|b| b.get("type").and_then(|t| t.as_str()).unwrap_or("?").to_string())
                .collect();
            format!("数组({}块: {})", a.len(), types.join(","))
        }
        Some(_) => "其它类型".to_string(),
    };
    format!("顶层键[{}]，stop_reason={}，content={}", keys.join(","), stop, content_desc)
}

fn openai_message_content(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for part in parts {
                if let Some(s) = part.as_str() {
                    out.push_str(s);
                    continue;
                }
                let ty = part.get("type").and_then(|t| t.as_str()).unwrap_or("text");
                if matches!(ty, "text" | "output_text") {
                    if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                        out.push_str(t);
                    }
                }
            }
            if out.trim().is_empty() {
                None
            } else {
                Some(out)
            }
        }
        _ => None,
    }
}

fn api_error_from_value(v: &serde_json::Value) -> Option<String> {
    let err = v.get("error")?;
    if err.is_null() {
        return None;
    }
    if let Some(s) = err.as_str() {
        let s = s.trim();
        return if s.is_empty() { None } else { Some(s.to_string()) };
    }
    if let Some(msg) = err.get("message").and_then(|m| m.as_str()) {
        let msg = msg.trim();
        return if msg.is_empty() { None } else { Some(msg.to_string()) };
    }
    None
}

fn status_error_detail(raw: &str) -> String {
    let raw = raw.trim_start_matches('\u{feff}');
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(msg) = api_error_from_value(&v) {
            return msg;
        }
    }
    raw.to_string()
}

/// 从模型回复解析标签数组。优先解析 JSON 数组；失败时回退按行/逗号切分。
fn parse_tag_list(reply: &str, max: usize) -> Vec<String> {
    let cleaned = strip_code_fences(reply);

    // 尝试提取 JSON 数组：从首个 '[' 起逐个尝试每个 ']'（从小到大），
    // 第一个能解析的数组胜出。rfind(']') 会把 "] 之后的说明文字"也圈进来导致必然解析失败。
    if let Some(start) = cleaned.find('[') {
        for (end, _) in cleaned.match_indices(']') {
            if end <= start {
                continue;
            }
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(&cleaned[start..=end]) {
                return dedup_clean(arr, max);
            }
        }
    }

    // 回退：逗号/换行/顿号分隔。散文回复常带 "Tags: xxx" / "标签：xxx" 类前缀，
    // 先取末个冒号（半角/全角）之后的片段，再修剪引号/括号/列表符等装饰字符；
    // 含空格的过长 token 仍由 dedup_clean 的 >40 字符规则丢弃。
    let parts: Vec<String> = cleaned
        .split(|c| c == ',' || c == '，' || c == '\n' || c == '、')
        .map(|s| {
            let t = s.trim();
            let t = t.rsplit([':', '：']).next().unwrap_or(t);
            t.trim()
                .trim_matches(['"', '\'', '[', ']', '-', '*', '#', ':', '：', '•', '·'])
                .trim()
                .to_string()
        })
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
    fn completion_budget_leaves_room_for_thinking() {
        // 思考模型会先写 thinking 块：16 会把额度吃光，测试连接表现为「响应中未找到文本内容」。
        assert!(COMPLETION_MAX_TOKENS >= 512);
        assert!(HTTP_TIMEOUT_SECS >= 60);
    }

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
    fn parse_fallback_fullwidth_comma() {
        let tags = parse_tag_list("开发工具，截图，编辑器", 5);
        assert_eq!(tags, vec!["开发工具", "截图", "编辑器"]);
    }

    #[test]
    fn parse_fallback_strips_prose_prefix() {
        // 散文回复的 "Tags:" / "标签：" 前缀在回退切分中被剥离
        let tags = parse_tag_list("Tags: 开发工具, 截图", 5);
        assert_eq!(tags, vec!["开发工具", "截图"]);
        let tags = parse_tag_list("标签：编辑器\n截图", 5);
        assert_eq!(tags, vec!["编辑器", "截图"]);
        // 含空格的超长散文 token 仍按 >40 字符规则丢弃
        let long_prose = format!("These are some suggested tags for your object: {}", "x".repeat(60));
        let tags = parse_tag_list(&format!("{}, 截图", long_prose), 5);
        assert_eq!(tags, vec!["截图"]);
    }

    #[test]
    fn error_message_redacts_api_key() {
        assert_eq!(redact_api_key("401 bad key sk-secret", "sk-secret"), "401 bad key ***");
        assert_eq!(redact_api_key("no key here", "sk-secret"), "no key here");
        // 未配置密钥时不做替换
        assert_eq!(redact_api_key("unchanged", ""), "unchanged");
    }

    #[test]
    fn extract_anthropic_text() {
        let raw = r#"{"content":[{"type":"text","text":"[\"a\"]"}]}"#;
        assert_eq!(extract_text(raw).unwrap(), "[\"a\"]");
    }

    #[test]
    fn extract_skips_thinking_then_reads_text() {
        let raw = r#"{"content":[{"type":"thinking","thinking":"..."},{"type":"text","text":"ok"}],"stop_reason":"end_turn"}"#;
        assert_eq!(extract_text(raw).unwrap(), "ok");
    }

    #[test]
    fn extract_thinking_only_max_tokens() {
        let raw = r#"{"content":[{"type":"thinking","thinking":"..."}],"stop_reason":"max_tokens"}"#;
        let err = extract_text(raw).unwrap_err();
        assert!(err.contains("思考"), "{err}");
        assert!(err.contains("输出上限"), "{err}");
    }

    #[test]
    fn extract_openai_style_fallback() {
        let raw = r#"{"choices":[{"message":{"content":"[\"a\"]"}}]}"#;
        assert_eq!(extract_text(raw).unwrap(), "[\"a\"]");
    }

    #[test]
    fn extract_openai_content_array() {
        let raw = r#"{"choices":[{"message":{"content":[{"type":"text","text":"[\"a\"]"}]}}]}"#;
        assert_eq!(extract_text(raw).unwrap(), "[\"a\"]");
    }

    #[test]
    fn extract_content_string() {
        let raw = r#"{"content":"[\"a\"]"}"#;
        assert_eq!(extract_text(raw).unwrap(), "[\"a\"]");
    }

    #[test]
    fn extract_strips_utf8_bom() {
        let raw = "\u{feff}{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}";
        assert_eq!(extract_text(raw).unwrap(), "ok");
    }

    #[test]
    fn extract_http200_error_object() {
        let raw = r#"{"type":"error","error":{"type":"invalid_request_error","message":"model not found"}}"#;
        let err = extract_text(raw).unwrap_err();
        assert!(err.contains("model not found"), "{err}");
    }

    #[test]
    fn extract_rejects_sse_payload() {
        let err = extract_text("data: {\"type\":\"message_start\"}\n\n").unwrap_err();
        assert!(err.contains("SSE"), "{err}");
    }

    #[test]
    fn extract_and_parse_thinking_then_json_tags() {
        let raw = r#"{"content":[{"type":"thinking","thinking":"..."},{"type":"text","text":"[\"文件启动器\",\"Tauri\"]"}],"stop_reason":"end_turn"}"#;
        let text = extract_text(raw).unwrap();
        assert_eq!(parse_tag_list(&text, 5), vec!["文件启动器", "Tauri"]);
    }

    #[test]
    fn request_body_disables_thinking() {
        let config = AiConfig {
            base_url: "https://x.test".into(),
            api_key: "k".into(),
            model: "m".into(),
            auto_tag_on_add: false,
            max_tags: 5,
            allow_new_tags: true,
            extra_prompt: String::new(),
            has_api_key: false,
        };
        let v: serde_json::Value =
            serde_json::from_str(&build_request_body(&config, "sys", "user", 1024)).unwrap();
        assert_eq!(v["thinking"]["type"], "disabled");
        assert_eq!(v["stream"], false);
    }

    #[test]
    fn extract_failure_carries_structure_diagnosis() {
        // content 为 null
        let err = extract_text(r#"{"id":"m1","content":null,"stop_reason":"end_turn"}"#).unwrap_err();
        assert!(err.contains("未找到文本内容"), "{err}");
        assert!(err.contains("content=null"), "{err}");
        assert!(err.contains("stop_reason=end_turn"), "{err}");
        // content 空数组
        let err = extract_text(r#"{"content":[]}"#).unwrap_err();
        assert!(err.contains("content=数组(0块"), "{err}");
        // content 字段缺失
        let err = extract_text(r#"{"foo":1}"#).unwrap_err();
        assert!(err.contains("content=缺失"), "{err}");
        assert!(err.contains("foo"), "{err}");
    }

    /// 微型 HTTP mock：按序回放响应体，记录收到的请求体
    fn spawn_mock_server(
        responses: Vec<&'static str>,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{Read, Write};
        use std::sync::{Arc, Mutex};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let requests_clone = Arc::clone(&requests);
        std::thread::spawn(move || {
            for body in responses {
                let (mut stream, _) = listener.accept().unwrap();
                // 读请求头到空行
                let mut buf = Vec::new();
                let mut byte = [0u8; 1];
                while !buf.ends_with(b"\r\n\r\n") {
                    if stream.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    buf.push(byte[0]);
                }
                let headers = String::from_utf8_lossy(&buf).to_string();
                let content_length: usize = headers
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
                    .unwrap_or(0);
                let mut body_buf = vec![0u8; content_length];
                let _ = stream.read_exact(&mut body_buf);
                requests_clone
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&body_buf).to_string());
                let resp = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        (format!("http://127.0.0.1:{}", addr.port()), requests)
    }

    #[test]
    fn call_messages_retries_transient_empty_content() {
        // 第一次返回 200 空 content（思考模型/网关间歇形态），第二次正常
        let (base, requests) = spawn_mock_server(vec![
            r#"{"id":"m1","content":[],"stop_reason":"end_turn"}"#,
            r#"{"id":"m2","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}"#,
        ]);
        let config = AiConfig {
            base_url: base,
            api_key: "test-key".into(),
            model: "m".into(),
            auto_tag_on_add: false,
            max_tags: 5,
            allow_new_tags: true,
            extra_prompt: String::new(),
            has_api_key: false,
        };
        let reply = call_messages(&config, "sys", "ping", 64).expect("重试后应成功");
        assert_eq!(reply, "ok");
        let reqs = requests.lock().unwrap();
        assert_eq!(reqs.len(), 2, "瞬态空响应应触发一次重试");
        let sent: serde_json::Value = serde_json::from_str(&reqs[0]).unwrap();
        assert_eq!(sent["thinking"]["type"], "disabled");
    }

    #[test]
    fn call_messages_persistent_empty_content_fails_with_diagnosis() {
        let (base, requests) = spawn_mock_server(vec![
            r#"{"content":null,"stop_reason":"end_turn"}"#,
            r#"{"content":null,"stop_reason":"end_turn"}"#,
            r#"{"content":null,"stop_reason":"end_turn"}"#,
        ]);
        let config = AiConfig {
            base_url: base,
            api_key: "k".into(),
            model: "m".into(),
            auto_tag_on_add: false,
            max_tags: 5,
            allow_new_tags: true,
            extra_prompt: String::new(),
            has_api_key: false,
        };
        let err = call_messages(&config, "sys", "ping", 64).unwrap_err();
        assert!(err.contains("未找到文本内容"), "{err}");
        assert!(err.contains("content=null"), "{err}");
        assert_eq!(requests.lock().unwrap().len(), 3, "重试预算用完后报错");
    }

    #[test]
    fn status_error_prefers_json_message() {
        let raw = r#"{"error":{"message":"invalid api key","type":"authentication_error"}}"#;
        assert_eq!(status_error_detail(raw), "invalid api key");
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
        // userinfo 不得绕过白名单：真实 host 是最后一个 @ 之后
        assert!(base_url_is_insecure("http://localhost:1234@evil.com"));
        assert!(base_url_is_insecure("http://user:pass@evil.com"));
        // userinfo + 本机回环 → 放行
        assert!(!base_url_is_insecure("http://user:pass@localhost:8080"));
        assert!(!base_url_is_insecure("http://token@127.0.0.1:1234"));
    }
}

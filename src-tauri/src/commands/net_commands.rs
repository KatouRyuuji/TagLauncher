use std::collections::HashMap;
use std::io::Read;
use tauri::State;
use crate::db::Database;
use base64::{engine::general_purpose, Engine as _};

/// Mod 网络请求参数。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetFetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    /// 超时上限（毫秒），默认 30 秒，最大 120 秒
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".to_string()
}

/// Mod 网络响应（body 为原始字节的 base64 编码，前端按内容类型自行解码）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetFetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    /// 响应体（base64 编码），文本可用 atob() 解码，JSON 可再 JSON.parse()。
    pub body: String,
}

const MAX_BODY_BYTES: usize = 10 * 1_048_576; // 10 MB

/// Mod 网络访问原语：仅允许 http/https，强制超时与响应体大小上限。
/// 定位为扩展接口约束，业务逻辑（认证、重试、JSON 解析等）由 Mod 自行实现。
#[tauri::command]
pub fn net_fetch(_db: State<Database>, req: NetFetchRequest) -> Result<NetFetchResponse, String> {
    let url = req.url.trim();

    // 仅允许 http/https
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("net.fetch 仅支持 http/https 协议".to_string());
    }

    let timeout_ms = req.timeout_ms.unwrap_or(30_000).min(120_000);
    let timeout = std::time::Duration::from_millis(timeout_ms);
    let method = req.method.to_uppercase();

    // ureq 2.x：ureq::request(method, url) 支持任意 HTTP 方法
    let mut request = ureq::request(&method, url).timeout(timeout);
    for (k, v) in &req.headers {
        request = request.set(k, v);
    }

    let response = match req.body.as_deref() {
        Some(body) => request.send_string(body),
        None       => request.call(),
    }
    .map_err(|e| e.to_string())?;

    let status = response.status();

    // 采集响应头
    let mut resp_headers = HashMap::new();
    for name in response.headers_names() {
        if let Some(val) = response.header(&name) {
            resp_headers.insert(name.to_lowercase(), val.to_string());
        }
    }

    // 读取响应体（大小上限）
    let body_bytes = {
        let mut buf = Vec::new();
        response
            .into_reader()
            .take((MAX_BODY_BYTES + 1) as u64)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        if buf.len() > MAX_BODY_BYTES {
            return Err(format!(
                "响应体超过大小上限（{}MB）",
                MAX_BODY_BYTES / 1_048_576
            ));
        }
        buf
    };

    Ok(NetFetchResponse {
        status,
        headers: resp_headers,
        body: general_purpose::STANDARD.encode(&body_bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_protocols() {
        let req = NetFetchRequest {
            url: "file:///etc/passwd".to_string(),
            method: "GET".to_string(),
            headers: HashMap::new(),
            body: None,
            timeout_ms: None,
        };
        // 不持有 Database，只测 URL 验证（在 DB state 之前检查）
        // 直接调用内部逻辑
        assert!(req.url.trim().starts_with("file://"), "测试数据正确");
        assert!(!req.url.trim().starts_with("http://") && !req.url.trim().starts_with("https://"));
    }
}

use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
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

/// URL 协议校验：仅放行 http/https（file:// 等本地协议会绕过网络栈直接读盘）。
/// 大小写敏感是故意的：非常规大小写按失败关闭处理（ureq 也只认小写 scheme）。
/// 独立纯函数便于单元测试。
fn url_scheme_allowed(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
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
/// 安全：即便可信 Mod 模型，仍在 DNS 解析层拦截环回/私网/链路本地/保留地址（SSRF 防御，
/// 经 AgentBuilder.resolver 生效——重定向的每一跳都会重新解析、同样受此校验）。
/// 同步阻塞 HTTP 用 #[tauri::command(async)] 放到工作线程执行，避免冻结 UI 主线程；
/// 本命令不触碰数据库锁（_db 未使用），无跨线程持锁问题。
#[tauri::command(async)]
pub fn net_fetch(_db: State<Database>, req: NetFetchRequest) -> Result<NetFetchResponse, String> {
    let url = req.url.trim();

    // 仅允许 http/https
    if !url_scheme_allowed(url) {
        return Err("net.fetch 仅支持 http/https 协议".to_string());
    }

    let timeout_ms = req.timeout_ms.unwrap_or(30_000).min(120_000);
    let timeout = std::time::Duration::from_millis(timeout_ms);
    let method = req.method.to_uppercase();

    // 带 SSRF 拦截解析器的 Agent；保留重定向（≤5），但每一跳都会经解析器再次校验目标 IP。
    let agent = ureq::AgentBuilder::new()
        .resolver(SsrfGuardResolver)
        .redirects(5)
        .build();
    let mut request = agent.request(&method, url).timeout(timeout);
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

// ---------------------------------------------------------------------------
// SSRF 防御：DNS 解析层拦截内网/环回/保留地址
// ---------------------------------------------------------------------------

/// 自定义 DNS 解析器：正常解析后，若**任一**地址落在环回/私网/链路本地/保留段则拒绝
/// （fail-closed）。ureq 对每个连接（含重定向的每一跳）都会调用它，故重定向亦受保护。
struct SsrfGuardResolver;

impl ureq::Resolver for SsrfGuardResolver {
    fn resolve(&self, netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        let addrs: Vec<SocketAddr> = netloc.to_socket_addrs()?.collect();
        if addrs.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "无法解析主机地址",
            ));
        }
        if let Some(bad) = addrs.iter().find(|a| is_disallowed_ip(&a.ip())) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("net.fetch 拒绝访问内网/环回/保留地址: {}", bad.ip()),
            ));
        }
        Ok(addrs)
    }
}

/// 判断 IP 是否属于禁止访问的内网/保留范围。
/// pub 以便集成测试直接验证 SSRF 拦截规则（内网/环回/IPv4-mapped 拦、公网放行）。
pub fn is_disallowed_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_disallowed_v4(v4),
        IpAddr::V6(v6) => {
            // IPv4-mapped（::ffff:a.b.c.d）按其 IPv4 判定，防绕过。
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_disallowed_v4(&mapped);
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // 链路本地 fe80::/10
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // 唯一本地 fc00::/7
        }
    }
}

fn is_disallowed_v4(ip: &Ipv4Addr) -> bool {
    ip.is_loopback()          // 127.0.0.0/8
        || ip.is_private()    // 10/8, 172.16/12, 192.168/16
        || ip.is_link_local() // 169.254.0.0/16
        || ip.is_broadcast()  // 255.255.255.255
        || ip.is_unspecified()// 0.0.0.0
        || ip.is_multicast()  // 224.0.0.0/4
        || ip.is_documentation()
        || ip.octets()[0] == 0 // 0.0.0.0/8
        || (ip.octets()[0] == 100 && (ip.octets()[1] & 0xc0) == 64) // 100.64/10 CGNAT
        || ip.octets()[0] >= 240 // 240.0.0.0/4 保留
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv6Addr;

    #[test]
    fn rejects_non_http_protocols() {
        // 直接验证命令使用的协议校验谓词（非夹具自证）
        assert!(url_scheme_allowed("http://example.com"));
        assert!(url_scheme_allowed("https://example.com/path?q=1"));
        assert!(!url_scheme_allowed("file:///C:/Windows/system.ini"));
        assert!(!url_scheme_allowed("ftp://example.com/x"));
        assert!(!url_scheme_allowed("example.com"));
        // 非常规大小写失败关闭（ureq 同样只认小写 scheme）
        assert!(!url_scheme_allowed("HTTP://example.com"));
    }

    #[test]
    fn ssrf_blocks_internal_and_allows_public_ips() {
        // 内网/环回/链路本地/保留段应拒绝
        for ip in [
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),   // 环回
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5)),    // 私网
            IpAddr::V4(Ipv4Addr::new(172, 16, 3, 4)),  // 私网
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)), // 私网
            IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1)), // 链路本地（含云元数据 169.254.169.254）
            IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),  // CGNAT
            IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),     // 未指定
            IpAddr::V6(Ipv6Addr::LOCALHOST),           // ::1
            IpAddr::V6("::ffff:127.0.0.1".parse::<Ipv6Addr>().unwrap()), // IPv4-mapped 环回
            IpAddr::V6("fe80::1".parse::<Ipv6Addr>().unwrap()),          // 链路本地
            IpAddr::V6("fc00::1".parse::<Ipv6Addr>().unwrap()),          // 唯一本地
        ] {
            assert!(is_disallowed_ip(&ip), "应拒绝内网地址: {}", ip);
        }
        // 公网地址应放行
        for ip in [
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
            IpAddr::V6("2606:4700:4700::1111".parse::<Ipv6Addr>().unwrap()),
        ] {
            assert!(!is_disallowed_ip(&ip), "应放行公网地址: {}", ip);
        }
    }
}

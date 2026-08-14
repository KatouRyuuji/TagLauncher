// ============================================================================
// sync_commands.rs — WebDAV 云同步（备份上传 / 恢复下载 / 远端列表）
// ============================================================================
// 设计要点：
// - 协议选 WebDAV：NAS（群晖/威联通）、Nextcloud、坚果云等主流个人云全部原生
//   支持，无厂商锁定，符合「全部本地化 + 可自建」定位。
// - 云端副本**剔除敏感配置**（ai.* 密钥与 sync.* 自身凭据）：第三方 WebDAV 服务
//   不应拿到明文密钥；恢复时保留本机现有凭据（见 preserve/reapply）。
// - 上传走 SQLite Online Backup 快照（页级一致），与本地备份/导出同一原语。
// - 允许 http://（局域网 NAS 常无 TLS），凭据仅发往用户自己填写的服务器；
//   UI 侧对 http 明确提示风险。不启用 mod net_fetch 的 SSRF 拦截——那是针对
//   不可信 Mod 的防线，云同步目标本就常在内网。
// - 远端保留最近 N 份时间戳文件，自动清理更早的（防止无限占用云端空间）。
// ============================================================================

use crate::commands::data_commands;
use crate::db::Database;
use crate::services::settings_service::{get_setting, set_setting};
use base64::{engine::general_purpose, Engine as _};
use rusqlite::Connection;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;

const KEY_URL: &str = "sync.webdav_url";
const KEY_USERNAME: &str = "sync.username";
const KEY_PASSWORD: &str = "sync.password";
const KEY_REMOTE_DIR: &str = "sync.remote_dir";
const KEY_AUTO: &str = "sync.auto";
const KEY_LAST_TS: &str = "sync.last_ts";

const DEFAULT_REMOTE_DIR: &str = "TagLauncher";
/// 云端保留的备份份数（按文件名时间戳排序，删除更早的）
const REMOTE_KEEP_COUNT: usize = 10;
/// 下载恢复的数据库大小上限（1 GiB，防异常服务器无限流）
const MAX_DOWNLOAD_BYTES: u64 = 1024 * 1_048_576;
/// 控制类请求超时（PROPFIND/MKCOL/DELETE）
const CONTROL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// 传输类请求超时（PUT/GET，大库 + 慢速 NAS 场景）
const TRANSFER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub url: String,
    pub username: String,
    /// set 时的新密码（留空 = 不修改）；get 时恒为空串（不下发明文）
    #[serde(default)]
    pub password: String,
    /// get 时输出：是否已存有密码
    #[serde(default)]
    pub has_password: bool,
    pub remote_dir: String,
    pub auto_sync: bool,
    /// get 时输出：上次成功同步的 epoch 秒（0 = 从未同步）
    #[serde(default)]
    pub last_sync_ts: i64,
}

#[tauri::command]
pub fn sync_get_config(db: State<Database>) -> SyncConfig {
    let conn = db.get_conn();
    SyncConfig {
        url: get_setting(&conn, KEY_URL).unwrap_or_default(),
        username: get_setting(&conn, KEY_USERNAME).unwrap_or_default(),
        password: String::new(),
        has_password: get_setting(&conn, KEY_PASSWORD).map(|s| !s.is_empty()).unwrap_or(false),
        remote_dir: get_setting(&conn, KEY_REMOTE_DIR)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_REMOTE_DIR.to_string()),
        auto_sync: get_setting(&conn, KEY_AUTO).as_deref() == Some("1"),
        last_sync_ts: get_setting(&conn, KEY_LAST_TS)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0),
    }
}

#[tauri::command]
pub fn sync_set_config(db: State<Database>, config: SyncConfig) -> Result<(), String> {
    let url = config.url.trim();
    if !url.is_empty() && !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("WebDAV 地址必须以 http:// 或 https:// 开头".to_string());
    }
    let remote_dir = normalize_remote_dir(&config.remote_dir)?;

    let conn = db.get_conn();
    // 多键写入包在一个事务里，防止半截配置（与 ai_set_config 同一策略）
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    set_setting(&tx, KEY_URL, url)?;
    set_setting(&tx, KEY_USERNAME, config.username.trim())?;
    // 密码留空 = 不修改（前端不持有明文，回存整份配置时不能清掉已存密码）
    let new_password = config.password.trim();
    if !new_password.is_empty() {
        set_setting(&tx, KEY_PASSWORD, new_password)?;
    }
    set_setting(&tx, KEY_REMOTE_DIR, &remote_dir)?;
    set_setting(&tx, KEY_AUTO, if config.auto_sync { "1" } else { "0" })?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 显式清除已存密码（「留空=不修改」语义下删除凭据的专用通道）。
#[tauri::command]
pub fn sync_clear_password(db: State<Database>) -> Result<(), String> {
    let conn = db.get_conn();
    conn.execute("DELETE FROM app_meta WHERE key = ?1", [KEY_PASSWORD])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 远端操作命令
// ---------------------------------------------------------------------------

/// 测试连接：PROPFIND 服务器根 → 确保远端目录存在（逐级 MKCOL）。
/// 同步阻塞 HTTP 用 (async) 放到工作线程；凭据读取在锁内小段完成后立即释放。
#[tauri::command(async)]
pub fn sync_test_connection(db: State<Database>) -> Result<String, String> {
    let ctx = load_context(&db)?;
    // 先验证凭据与地址可达
    dav_propfind(&ctx, "", 0)?;
    // 再确保备份目录存在
    ensure_remote_dir(&ctx)?;
    Ok(format!("已连通，备份目录 {} 就绪", ctx.remote_dir))
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackup {
    pub name: String,
    pub size_bytes: u64,
    /// 服务器返回的最后修改时间原文（RFC 1123，仅展示用）
    pub modified: String,
}

/// 列出远端备份目录中的数据库文件（按名称降序 = 时间从新到旧）。
#[tauri::command(async)]
pub fn sync_list_backups(db: State<Database>) -> Result<Vec<RemoteBackup>, String> {
    let ctx = load_context(&db)?;
    ensure_remote_dir(&ctx)?;
    list_remote_backups(&ctx)
}

/// 立即备份到云端：快照 → 剔除敏感配置 → 上传 → 清理旧份 → 记录时间。
/// 返回云端文件名。
#[tauri::command(async)]
pub fn sync_backup_now(db: State<Database>) -> Result<String, String> {
    let ctx = load_context(&db)?;
    ensure_remote_dir(&ctx)?;

    // 1. 快照到临时文件（Online Backup，页级一致）
    let temp = temp_file_path("upload");
    let result = (|| {
        data_commands::snapshot_live_db(&db, &temp)?;
        // 2. 云端副本剔除敏感配置：AI 密钥与云同步凭据自身
        strip_cloud_secrets(&temp)?;

        // 3. 上传
        let file_name = format!("taglauncher_{}.db", data_commands::utc_timestamp_compact());
        let file = std::fs::File::open(&temp).map_err(|e| format!("读取快照失败: {}", e))?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        dav_put(&ctx, &file_name, file, size)?;

        // 4. 清理旧份（尽力而为，失败不影响本次备份结果）
        if let Ok(list) = list_remote_backups(&ctx) {
            for stale in select_stale_backups(&list, REMOTE_KEEP_COUNT) {
                let _ = dav_delete(&ctx, &stale);
            }
        }

        // 5. 记录成功时间
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        {
            let conn = db.get_conn();
            set_setting(&conn, KEY_LAST_TS, &now.to_string())?;
        }
        Ok(file_name)
    })();
    let _ = std::fs::remove_file(&temp);
    result
}

/// 从云端恢复：下载 → 校验 → 本地安全备份 → 覆盖实库（保留本机凭据）。
/// 返回本地安全备份路径；调用方应在成功后重启应用。
#[tauri::command(async)]
pub fn sync_restore(
    app: tauri::AppHandle,
    db: State<Database>,
    file_name: String,
) -> Result<String, String> {
    let name = file_name.trim();
    // 远端列表返回的文件名不应含路径分隔符；防御异常输入拼出目录穿越 URL
    if name.is_empty() || name.contains('/') || name.contains('\\') || !name.ends_with(".db") {
        return Err("非法的云端备份文件名".to_string());
    }
    let ctx = load_context(&db)?;

    // 1. 下载到临时文件
    let temp = temp_file_path("restore");
    let result = (|| {
        dav_get_to_file(&ctx, name, &temp)?;

        // 2. 校验是合法的 TagLauncher 库且 schema 不高于当前版本
        let source_version = data_commands::validate_importable_db(&temp)?;
        let current_version = live_schema_version(&db);
        if current_version > 0 && source_version > current_version {
            return Err(format!(
                "云端备份 schema 版本(v{})高于当前应用支持的版本(v{})，请先升级 TagLauncher",
                source_version, current_version
            ));
        }

        // 3. 本地安全备份（可回退）
        let paths = crate::services::path_service::resolve_app_paths(&app);
        let backups_dir = paths.save_dir.join("Backups");
        std::fs::create_dir_all(&backups_dir).map_err(|e| format!("无法创建备份目录: {}", e))?;
        let safety = backups_dir.join(format!(
            "taglauncher_pre_restore_{}.db",
            data_commands::utc_timestamp_compact()
        ));
        data_commands::snapshot_live_db(&db, &safety)?;

        // 4. 保留本机凭据（云端副本无 ai.*/sync.*；覆盖后回填本机现值，
        //    否则恢复一次云同步配置就丢，用户须重新配置才能继续同步）
        let local_secrets = read_local_secrets(&db);

        // 5. 覆盖实库；失败自动回滚到安全备份
        if let Err(e) = data_commands::overwrite_live_from(&db, &temp) {
            return match data_commands::overwrite_live_from(&db, &safety) {
                Ok(()) => Err(format!("恢复失败，已自动回滚到恢复前状态：{}", e)),
                Err(re) => Err(format!(
                    "恢复失败且自动回滚也失败：{}（原始错误：{}）。可手动用安全备份恢复：{}",
                    re,
                    e,
                    safety.to_string_lossy()
                )),
            };
        }

        // 6. 回填本机凭据。失败时不回滚恢复本身（数据已就位，回滚反而丢掉用户想恢复的
        // 内容），但错误消息须说清现状：恢复已成功、仅本机凭据需重新配置。
        if let Err(e) = reapply_local_secrets(&db, &local_secrets) {
            return Err(format!(
                "数据已恢复，但回填本机 AI/云同步凭据失败（{}）。请在设置中重新配置这些凭据。安全备份：{}",
                e,
                safety.to_string_lossy()
            ));
        }

        Ok(safety.to_string_lossy().to_string())
    })();
    let _ = std::fs::remove_file(&temp);
    result
}

// ---------------------------------------------------------------------------
// 内部：上下文与凭据
// ---------------------------------------------------------------------------

/// 一次远端操作所需的连接上下文（凭据在锁内读出后立即释放锁）。
struct DavContext {
    base_url: String,
    auth_header: Option<String>,
    remote_dir: String,
}

fn load_context(db: &Database) -> Result<DavContext, String> {
    let (url, username, password, remote_dir) = {
        let conn = db.get_conn();
        (
            get_setting(&conn, KEY_URL).unwrap_or_default(),
            get_setting(&conn, KEY_USERNAME).unwrap_or_default(),
            get_setting(&conn, KEY_PASSWORD).unwrap_or_default(),
            get_setting(&conn, KEY_REMOTE_DIR)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_REMOTE_DIR.to_string()),
        )
    };
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("尚未配置 WebDAV 服务器地址".to_string());
    }
    let auth_header = if username.is_empty() {
        None
    } else {
        Some(format!(
            "Basic {}",
            general_purpose::STANDARD.encode(format!("{}:{}", username, password))
        ))
    };
    Ok(DavContext {
        base_url: url,
        auth_header,
        remote_dir: normalize_remote_dir(&remote_dir)?,
    })
}

/// 规范化远端目录：去除首尾斜杠与空段；拒绝 ".." 段（目录穿越）。
/// 独立纯函数便于单元测试。
fn normalize_remote_dir(dir: &str) -> Result<String, String> {
    let segments: Vec<&str> = dir
        .split('/')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if segments.iter().any(|s| *s == "." || *s == "..") {
        return Err("远端目录不能包含 . 或 .. 路径段".to_string());
    }
    if segments.is_empty() {
        return Ok(DEFAULT_REMOTE_DIR.to_string());
    }
    Ok(segments.join("/"))
}

// ---------------------------------------------------------------------------
// 内部：WebDAV 原语（ureq）
// ---------------------------------------------------------------------------

fn dav_request(ctx: &DavContext, method: &str, path: &str) -> ureq::Request {
    let url = build_url(&ctx.base_url, &ctx.remote_dir, path);
    let mut req = ureq::AgentBuilder::new().build().request(method, &url);
    if let Some(auth) = &ctx.auth_header {
        req = req.set("Authorization", auth);
    }
    req
}

/// PROPFIND：path 为空 = 服务器根（不含 remote_dir）；否则相对 remote_dir。
fn dav_propfind(ctx: &DavContext, path: &str, depth: u8) -> Result<String, String> {
    let url = if path.is_empty() && depth == 0 {
        // 根探测：只测地址+凭据（remote_dir 可能尚不存在）
        format!("{}/", ctx.base_url)
    } else {
        build_url(&ctx.base_url, &ctx.remote_dir, path)
    };
    let mut req = ureq::AgentBuilder::new()
        .build()
        .request("PROPFIND", &url)
        .set("Depth", &depth.to_string())
        .timeout(CONTROL_TIMEOUT);
    if let Some(auth) = &ctx.auth_header {
        req = req.set("Authorization", auth);
    }
    let resp = req.call().map_err(map_dav_error)?;
    let mut body = String::new();
    resp.into_reader()
        .take(8 * 1_048_576)
        .read_to_string(&mut body)
        .map_err(|e| format!("读取服务器响应失败: {}", e))?;
    Ok(body)
}

/// 逐级 MKCOL 确保远端目录存在（405 = 已存在，视为成功）。
fn ensure_remote_dir(ctx: &DavContext) -> Result<(), String> {
    let segments: Vec<&str> = ctx.remote_dir.split('/').collect();
    let mut current = String::new();
    for seg in segments {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(seg);
        let url = format!(
            "{}/{}/",
            ctx.base_url,
            encode_path_segments(&current)
        );
        let mut req = ureq::AgentBuilder::new()
            .build()
            .request("MKCOL", &url)
            .timeout(CONTROL_TIMEOUT);
        if let Some(auth) = &ctx.auth_header {
            req = req.set("Authorization", auth);
        }
        match req.call() {
            Ok(_) => {}
            // 405 Method Not Allowed = 集合已存在；301/302 部分服务器对已存在目录重定向
            Err(ureq::Error::Status(405, _)) => {}
            Err(ureq::Error::Status(301, _)) | Err(ureq::Error::Status(302, _)) => {}
            Err(e) => return Err(map_dav_error(e)),
        }
    }
    Ok(())
}

fn dav_put(
    ctx: &DavContext,
    file_name: &str,
    reader: impl Read + Send + 'static,
    size: u64,
) -> Result<(), String> {
    let resp = dav_request(ctx, "PUT", file_name)
        .set("Content-Type", "application/octet-stream")
        .set("Content-Length", &size.to_string())
        .timeout(TRANSFER_TIMEOUT)
        .send(reader);
    match resp {
        Ok(_) => Ok(()),
        Err(e) => Err(map_dav_error(e)),
    }
}

fn dav_get_to_file(ctx: &DavContext, file_name: &str, target: &Path) -> Result<(), String> {
    let resp = dav_request(ctx, "GET", file_name)
        .timeout(TRANSFER_TIMEOUT)
        .call()
        .map_err(map_dav_error)?;
    let mut reader = resp.into_reader().take(MAX_DOWNLOAD_BYTES + 1);
    let mut file = std::fs::File::create(target).map_err(|e| format!("创建临时文件失败: {}", e))?;
    let copied = std::io::copy(&mut reader, &mut file).map_err(|e| format!("下载失败: {}", e))?;
    if copied > MAX_DOWNLOAD_BYTES {
        return Err("云端文件超过大小上限（1 GiB），已中止".to_string());
    }
    Ok(())
}

fn dav_delete(ctx: &DavContext, file_name: &str) -> Result<(), String> {
    dav_request(ctx, "DELETE", file_name)
        .timeout(CONTROL_TIMEOUT)
        .call()
        .map(|_| ())
        .map_err(map_dav_error)
}

fn list_remote_backups(ctx: &DavContext) -> Result<Vec<RemoteBackup>, String> {
    let xml = dav_propfind(ctx, "/", 1)?;
    let mut backups = parse_propfind_backups(&xml);
    // 名称含 UTC 时间戳，字典序即时间序；降序 = 最新在前
    backups.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(backups)
}

/// 从远端列表中选出应清理的旧备份名（保留最新 keep 份）。
/// 独立纯函数便于单元测试。
fn select_stale_backups(list: &[RemoteBackup], keep: usize) -> Vec<String> {
    let mut names: Vec<&str> = list.iter().map(|b| b.name.as_str()).collect();
    names.sort_unstable_by(|a, b| b.cmp(a)); // 降序：新在前
    names.iter().skip(keep).map(|s| s.to_string()).collect()
}

/// WebDAV 错误 → 用户可读文案。
fn map_dav_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401, _) => "认证失败：用户名或密码错误".to_string(),
        ureq::Error::Status(403, _) => "服务器拒绝访问（权限不足）".to_string(),
        ureq::Error::Status(404, _) => "远端路径不存在".to_string(),
        ureq::Error::Status(405, _) => "服务器不支持该 WebDAV 操作".to_string(),
        ureq::Error::Status(507, _) => "服务器存储空间不足".to_string(),
        ureq::Error::Status(code, _) => format!("服务器返回错误状态 {}", code),
        ureq::Error::Transport(t) => format!("网络错误: {}", t),
    }
}

// ---------------------------------------------------------------------------
// 内部：URL 构造与编码
// ---------------------------------------------------------------------------

/// 拼接 base/remote_dir/path 为完整 URL（各路径段做百分号编码）。
fn build_url(base: &str, remote_dir: &str, path: &str) -> String {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        format!("{}/{}/", base, encode_path_segments(remote_dir))
    } else {
        format!(
            "{}/{}/{}",
            base,
            encode_path_segments(remote_dir),
            encode_path_segments(trimmed)
        )
    }
}

/// 对路径逐段做百分号编码（保留段间 '/'）。
fn encode_path_segments(path: &str) -> String {
    path.split('/')
        .map(percent_encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

/// RFC 3986 非保留字符之外全部编码（含中文目录名场景）。
fn percent_encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for byte in seg.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

/// 百分号解码（PROPFIND href 中的编码文件名）。非法编码原样保留。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ---------------------------------------------------------------------------
// 内部：PROPFIND multistatus 解析（免第三方 XML 依赖）
// ---------------------------------------------------------------------------

/// 从 PROPFIND Depth:1 响应中提取本目录下的 taglauncher_*.db 文件。
/// 仅依赖 WebDAV 规范保证的结构：每个 <X:response> 内有 <X:href>，
/// 属性块中可能有 getcontentlength/getlastmodified。命名空间前缀任意。
fn parse_propfind_backups(xml: &str) -> Vec<RemoteBackup> {
    let mut result = Vec::new();
    for block in split_xml_blocks(xml, "response") {
        let href = extract_first_tag_text(&block, "href").unwrap_or_default();
        if href.is_empty() {
            continue;
        }
        // href 是 URL 路径，取最后一个非空段作为文件名并解码
        let name = percent_decode(href.trim_end_matches('/').rsplit('/').next().unwrap_or(""));
        if !name.starts_with("taglauncher_") || !name.ends_with(".db") {
            continue;
        }
        let size = extract_first_tag_text(&block, "getcontentlength")
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let modified = extract_first_tag_text(&block, "getlastmodified").unwrap_or_default();
        result.push(RemoteBackup {
            name,
            size_bytes: size,
            modified,
        });
    }
    result
}

/// 按局部标签名切出 XML 块（如所有 <D:response>...</D:response>）。
/// 大小写不敏感、命名空间前缀任意。
fn split_xml_blocks(xml: &str, local_name: &str) -> Vec<String> {
    let lower = xml.to_ascii_lowercase();
    let name = local_name.to_ascii_lowercase();
    let mut blocks = Vec::new();
    let mut cursor = 0;
    while let Some(open_rel) = find_tag_open(&lower[cursor..], &name) {
        let open = cursor + open_rel;
        // 找到本块的关闭标签
        let close_pat_a = format!("</{}", name);
        let after_open = open + 1;
        let close_rel = lower[after_open..].find(&close_pat_a).or_else(|| {
            // 带命名空间前缀的关闭标签：</d:response>
            find_close_with_prefix(&lower[after_open..], &name)
        });
        match close_rel {
            Some(rel) => {
                let close = after_open + rel;
                blocks.push(xml[open..close].to_string());
                cursor = close + 1;
            }
            None => break,
        }
    }
    blocks
}

/// 在 haystack 中查找 `<name` 或 `<prefix:name` 形式的开标签位置。
fn find_tag_open(haystack: &str, name: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(lt_rel) = haystack[search_from..].find('<') {
        let lt = search_from + lt_rel;
        let rest = &haystack[lt + 1..];
        // 跳过关闭标签
        if rest.starts_with('/') {
            search_from = lt + 1;
            continue;
        }
        // <name 或 <prefix:name，且后随分隔符（> 空格 / 或行尾）
        let tag_end = rest
            .find(|c: char| c == '>' || c == ' ' || c == '/' || c == '\t' || c == '\n' || c == '\r')
            .unwrap_or(rest.len());
        let tag = &rest[..tag_end];
        let local = tag.rsplit(':').next().unwrap_or(tag);
        if local == name {
            return Some(lt);
        }
        search_from = lt + 1;
    }
    None
}

/// 查找 `</prefix:name` 形式的关闭标签（前缀任意）。
fn find_close_with_prefix(haystack: &str, name: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(lt_rel) = haystack[search_from..].find("</") {
        let lt = search_from + lt_rel;
        let rest = &haystack[lt + 2..];
        let tag_end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..tag_end];
        let local = tag.rsplit(':').next().unwrap_or(tag);
        if local.trim() == name {
            return Some(lt);
        }
        search_from = lt + 2;
    }
    None
}

/// 提取块内第一个指定局部名标签的文本内容（大小写/前缀不敏感）。
fn extract_first_tag_text(block: &str, local_name: &str) -> Option<String> {
    let lower = block.to_ascii_lowercase();
    let name = local_name.to_ascii_lowercase();
    let open = find_tag_open(&lower, &name)?;
    // 定位开标签的 '>'
    let gt = lower[open..].find('>')? + open;
    // 自闭合标签（<x/>）无文本
    if lower[..gt].ends_with('/') {
        return None;
    }
    let text_start = gt + 1;
    let text_end = lower[text_start..].find('<')? + text_start;
    Some(block[text_start..text_end].trim().to_string())
}

// ---------------------------------------------------------------------------
// 内部：敏感配置处理
// ---------------------------------------------------------------------------

/// 云端副本剔除敏感配置：AI 密钥 + 云同步凭据自身。
/// DELETE 后 VACUUM 重写文件，确保明文不残留在空闲页（与 export 同一策略）。
/// pub 以便集成测试验证云端副本不含 ai.*/sync.* 键。
pub fn strip_cloud_secrets(db_file: &Path) -> Result<(), String> {
    let conn = Connection::open(db_file)
        .map_err(|e| format!("无法打开云端副本以清理敏感配置: {}", e))?;
    conn.execute_batch(
        "DELETE FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'; VACUUM;",
    )
    .map_err(|e| format!("清理敏感配置失败: {}", e))?;
    Ok(())
}

/// 读取本机敏感/本机域配置（ai.* 与 sync.*），恢复覆盖后回填。
/// pub 以便集成测试验证「恢复保留本机凭据」这一原语。
pub fn read_local_secrets(db: &Database) -> Vec<(String, String)> {
    let conn = db.get_conn();
    let mut stmt = match conn
        .prepare("SELECT key, value FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'")
    {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
    match rows {
        Ok(iter) => iter.flatten().collect(),
        Err(_) => Vec::new(),
    }
}

/// 覆盖恢复后回填本机配置：先清掉恢复库里可能带的同类键（手动上传的未剔除副本），
/// 再写入本机现值——本机凭据优先，恢复操作不得让云同步配置自身失效。
/// pub 以便集成测试验证「恢复保留本机凭据」这一原语。
pub fn reapply_local_secrets(db: &Database, secrets: &[(String, String)]) -> Result<(), String> {
    let conn = db.get_conn();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("DELETE FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'")
        .map_err(|e| e.to_string())?;
    for (key, value) in secrets {
        tx.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)",
            [key.as_str(), value.as_str()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn live_schema_version(db: &Database) -> u32 {
    let conn = db.get_conn();
    conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='schema_version'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn temp_file_path(purpose: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "taglauncher_sync_{}_{}_{}.db",
        purpose,
        std::process::id(),
        data_commands::utc_timestamp_compact()
    ))
}

// ---------------------------------------------------------------------------
// 单元测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_remote_dir_variants() {
        assert_eq!(normalize_remote_dir("TagLauncher").unwrap(), "TagLauncher");
        assert_eq!(normalize_remote_dir("/a/b/").unwrap(), "a/b");
        assert_eq!(normalize_remote_dir("  ").unwrap(), DEFAULT_REMOTE_DIR);
        assert_eq!(normalize_remote_dir("a//b").unwrap(), "a/b");
        assert!(normalize_remote_dir("a/../b").is_err());
        assert!(normalize_remote_dir("..").is_err());
    }

    #[test]
    fn url_building_encodes_segments() {
        assert_eq!(
            build_url("https://dav.example.com/dav", "TagLauncher", "a.db"),
            "https://dav.example.com/dav/TagLauncher/a.db"
        );
        assert_eq!(
            build_url("https://dav.example.com", "备份/tl", ""),
            "https://dav.example.com/%E5%A4%87%E4%BB%BD/tl/"
        );
        assert_eq!(
            build_url("http://192.168.1.10:5005", "TagLauncher", "x y.db"),
            "http://192.168.1.10:5005/TagLauncher/x%20y.db"
        );
    }

    #[test]
    fn percent_roundtrip() {
        let name = "taglauncher_20260101_120000_001.db";
        assert_eq!(percent_decode(&percent_encode_segment(name)), name);
        assert_eq!(percent_decode("%E5%A4%87%E4%BB%BD"), "备份");
        // 非法编码原样保留
        assert_eq!(percent_decode("a%ZZb"), "a%ZZb");
    }

    #[test]
    fn parses_apache_style_multistatus() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/TagLauncher/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/TagLauncher/taglauncher_20260101_100000_000.db</D:href>
    <D:propstat><D:prop>
      <D:getcontentlength>2048</D:getcontentlength>
      <D:getlastmodified>Thu, 01 Jan 2026 10:00:00 GMT</D:getlastmodified>
    </D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/TagLauncher/other.txt</D:href>
    <D:propstat><D:prop><D:getcontentlength>5</D:getcontentlength></D:prop></D:propstat>
  </D:response>
</D:multistatus>"#;
        let backups = parse_propfind_backups(xml);
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].name, "taglauncher_20260101_100000_000.db");
        assert_eq!(backups[0].size_bytes, 2048);
        assert_eq!(backups[0].modified, "Thu, 01 Jan 2026 10:00:00 GMT");
    }

    #[test]
    fn parses_lowercase_prefix_and_encoded_href() {
        let xml = r#"<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/user/TagLauncher/taglauncher_20260202_090000_123.db</d:href>
    <d:propstat><d:prop><d:getcontentlength>77</d:getcontentlength></d:prop></d:propstat>
  </d:response>
</d:multistatus>"#;
        let backups = parse_propfind_backups(xml);
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].name, "taglauncher_20260202_090000_123.db");
        assert_eq!(backups[0].size_bytes, 77);
    }

    #[test]
    fn parses_no_prefix_namespace() {
        let xml = r#"<multistatus xmlns="DAV:">
  <response>
    <href>/dav/TagLauncher/taglauncher_20260303_080000_000.db</href>
    <propstat><prop><getcontentlength>10</getcontentlength></prop></propstat>
  </response>
</multistatus>"#;
        let backups = parse_propfind_backups(xml);
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].name, "taglauncher_20260303_080000_000.db");
    }

    #[test]
    fn stale_selection_keeps_newest() {
        let list: Vec<RemoteBackup> = [
            "taglauncher_20260101_000000_000.db",
            "taglauncher_20260103_000000_000.db",
            "taglauncher_20260102_000000_000.db",
        ]
        .iter()
        .map(|n| RemoteBackup {
            name: n.to_string(),
            size_bytes: 0,
            modified: String::new(),
        })
        .collect();
        let stale = select_stale_backups(&list, 2);
        assert_eq!(stale, vec!["taglauncher_20260101_000000_000.db".to_string()]);
        assert!(select_stale_backups(&list, 10).is_empty());
    }

    #[test]
    fn strip_cloud_secrets_removes_ai_and_sync_keys() {
        let mut p = std::env::temp_dir();
        p.push(format!("tl_strip_cloud_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let conn = Connection::open(&p).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO app_meta VALUES ('ai.api_key', 'sk-secret');
                 INSERT INTO app_meta VALUES ('sync.password', 'dav-pass');
                 INSERT INTO app_meta VALUES ('sync.webdav_url', 'https://x');
                 INSERT INTO app_meta VALUES ('theme', 'dark');",
            )
            .unwrap();
        }

        strip_cloud_secrets(&p).expect("strip should succeed");

        let conn = Connection::open(&p).unwrap();
        let secret_cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_meta WHERE key LIKE 'ai.%' OR key LIKE 'sync.%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let theme_cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_meta WHERE key='theme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(secret_cnt, 0, "ai.*/sync.* 应全部清除");
        assert_eq!(theme_cnt, 1, "非敏感键应保留");
        drop(conn);
        let _ = std::fs::remove_file(&p);
    }
}

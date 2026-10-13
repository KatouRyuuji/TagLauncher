//! 极简 MCP（Model Context Protocol）stdio server。
//!
//! 协议面锁定在 tools 子集：initialize / notifications/initialized / ping /
//! tools/list / tools/call，newline-delimited JSON-RPC 2.0（每行一条消息）。
//! 工具实现与 tl CLI 共用同一服务层，行为与 GUI 一致。
//!
//! 不引异步运行时：MCP stdio 是严格的请求-响应回环，同步逐行处理即可。

use crate::db::Database;
use crate::models::{ItemWithTags, Tag};
use crate::services::{
    cabinet_service, item_service, launch_service, search_service, tag_service,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, Write};

/// 握手可用的协议版本，首项为默认。客户端请求其中之一时按请求版本回复。
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// 握手时下发给 AI 客户端的使用准则。
const INSTRUCTIONS: &str = "TagLauncher 是本机的标签式启动器。先用 overview 了解标签与文件柜，再用 search_items 找到对象，之后按 id 操作。launch_item 会真正打开文件或运行程序，用户没有明确要求时先确认；remove_items 只移出库，不删除磁盘文件；set_item_tags 整体替换标签，追加前先用 get_item 读出现有标签。";

fn negotiate_version(requested: Option<&str>) -> &'static str {
    PROTOCOL_VERSIONS
        .iter()
        .copied()
        .find(|v| Some(*v) == requested)
        .unwrap_or(PROTOCOL_VERSIONS[0])
}
const DEFAULT_TAG_COLOR: &str = "#3b82f6";

pub fn serve_stdio() -> Result<(), String> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    // 数据库延迟到首个 tools/call 才打开：initialize 握手不依赖库可用性，
    // AI 客户端探活/列工具不受「主程序未初始化」影响。
    let mut db: Option<Database> = None;

    for line in stdin.lock().lines() {
        let line = line.map_err(|e| format!("读取 stdin 失败: {e}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue, // 非 JSON 行：忽略（容忍宿主探针输出）
        };
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let id = msg.get("id").cloned();

        // 通知（无 id）不产生响应
        let Some(id) = id else { continue };

        let response = match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": negotiate_version(
                        msg.pointer("/params/protocolVersion").and_then(Value::as_str),
                    ),
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "tag-launcher",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": INSTRUCTIONS,
                }
            }),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "tools": tool_definitions() }
            }),
            "tools/call" => {
                let params = msg.get("params").cloned().unwrap_or(json!({}));
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                if db.is_none() {
                    match super::open_db() {
                        Ok(d) => db = Some(d),
                        Err(e) => {
                            write_json(&mut out, &tool_error(&id, &e));
                            continue;
                        }
                    }
                }
                let result = call_tool(db.as_ref().expect("db just opened"), name, &args);
                write_json(&mut out, &result.to_response(&id));
                continue;
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("未知方法: {method}") }
            }),
        };
        write_json(&mut out, &response);
    }
    Ok(())
}

fn write_json(out: &mut impl Write, value: &Value) {
    // 单行 JSON + flush；写失败（宿主关闭管道）直接结束进程
    if writeln!(out, "{value}").and_then(|_| out.flush()).is_err() {
        std::process::exit(0);
    }
}

enum ToolResult {
    Ok(Value),
    Err(String),
}

impl ToolResult {
    fn to_response(&self, id: &Value) -> Value {
        match self {
            ToolResult::Ok(v) => {
                let text = v.to_string();
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "content": [{ "type": "text", "text": text }] }
                })
            }
            ToolResult::Err(e) => tool_error(id, e),
        }
    }
}

fn tool_error(id: &Value, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "isError": true
        }
    })
}

fn tool_definitions() -> Value {
    let read_only = json!({ "readOnlyHint": true, "openWorldHint": false });
    let ids = json!({ "type": "array", "items": { "type": "integer" } });
    json!([
        {
            "name": "search_items",
            "description": "搜索对象（文件、文件夹、应用等），条件之间取交集；不给条件即列出全部。返回 total 与精简列表，完整信息用 get_item。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "关键词，匹配名称和路径" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "标签名，需同时具备，含子标签" },
                    "cabinet_id": { "type": "integer" },
                    "type": { "type": "string", "enum": ["folder", "image", "audio", "video", "exe", "bat", "ps1", "text"] },
                    "limit": { "type": "integer", "description": "默认 50" }
                }
            },
            "annotations": read_only
        },
        {
            "name": "get_item",
            "description": "按 id 查看对象的完整信息。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "integer" } },
                "required": ["id"]
            },
            "annotations": read_only
        },
        {
            "name": "overview",
            "description": "库概览：统计数字、全部标签和文件柜。",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read_only
        },
        {
            "name": "launch_item",
            "description": "用默认程序打开对象，等同双击。给 id，或给 query 启动搜索首个结果。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer" },
                    "query": { "type": "string" }
                }
            },
            "annotations": { "destructiveHint": true, "openWorldHint": true }
        },
        {
            "name": "add_items",
            "description": "把文件或文件夹加入库，已在库中的不重复添加。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "绝对路径" }
                },
                "required": ["paths"]
            },
            "annotations": { "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "remove_items",
            "description": "把对象移出库，不删除磁盘文件。",
            "inputSchema": {
                "type": "object",
                "properties": { "ids": ids },
                "required": ["ids"]
            },
            "annotations": { "destructiveHint": true, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "add_tag",
            "description": "新建标签。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "color": { "type": "string", "description": "十六进制颜色，默认 #3b82f6" }
                },
                "required": ["name"]
            },
            "annotations": { "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "set_item_tags",
            "description": "整体替换对象的标签，空数组即清空。标签名须已存在，create_missing 为 true 时自动新建缺少的标签。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "item_id": { "type": "integer" },
                    "tag_names": { "type": "array", "items": { "type": "string" } },
                    "create_missing": { "type": "boolean" }
                },
                "required": ["item_id", "tag_names"]
            },
            "annotations": { "destructiveHint": true, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "set_favorite",
            "description": "收藏或取消收藏对象。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": ids,
                    "favorite": { "type": "boolean" }
                },
                "required": ["ids", "favorite"]
            },
            "annotations": { "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }
    ])
}

/// JSON-RPC 参数里的整数：number、整数字符串、无小数 float 都收。
fn json_i64(value: &Value) -> Option<i64> {
    if let Some(n) = value.as_i64() {
        return Some(n);
    }
    if let Some(n) = value.as_u64() {
        return i64::try_from(n).ok();
    }
    if let Some(s) = value.as_str() {
        return s.parse().ok();
    }
    if let Some(f) = value.as_f64() {
        if f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
            return Some(f as i64);
        }
    }
    None
}

fn json_i64_vec(value: Option<&Value>) -> Vec<i64> {
    value
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(json_i64).collect())
        .unwrap_or_default()
}

fn json_str_vec(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// 列表结果里的单个对象：只保留定位与识别所需字段，其余用 get_item 查。
fn brief_item(it: &ItemWithTags) -> Value {
    let mut v = json!({
        "id": it.item.id,
        "name": it.item.name,
        "path": it.item.path,
        "type": it.item.item_type,
        "tags": it.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
    });
    let obj = v.as_object_mut().expect("json object");
    if it.item.is_favorite {
        obj.insert("favorite".into(), json!(true));
    }
    if it.item.is_missing {
        obj.insert("missing".into(), json!(true));
    }
    if let Some(note) = it.item.note.as_deref().filter(|n| !n.is_empty()) {
        obj.insert("note".into(), json!(note));
    }
    v
}

fn find_tag<'a>(tags: &'a [Tag], name: &str) -> Option<&'a Tag> {
    tags.iter().find(|t| t.name.eq_ignore_ascii_case(name))
}

fn call_tool(db: &Database, name: &str, args: &Value) -> ToolResult {
    let conn = db.get_conn();
    match name {
        "search_items" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let tag_names = json_str_vec(args.get("tags"));
            let mut tag_ids = Vec::new();
            if !tag_names.is_empty() {
                let all = match tag_service::get_tags(&conn) {
                    Ok(v) => v,
                    Err(e) => return ToolResult::Err(e),
                };
                for name in &tag_names {
                    match find_tag(&all, name) {
                        Some(tag) => tag_ids.push(tag.id),
                        None => return ToolResult::Err(format!("标签「{name}」不存在")),
                    }
                }
            }
            let mut items = match search_service::search_items(&conn, query, &tag_ids) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            if let Some(cabinet_id) = args.get("cabinet_id").and_then(json_i64) {
                let members: HashSet<i64> =
                    match cabinet_service::get_cabinet_items(&conn, cabinet_id) {
                        Ok(v) => v.iter().map(|it| it.item.id).collect(),
                        Err(e) => return ToolResult::Err(e),
                    };
                items.retain(|it| members.contains(&it.item.id));
            }
            if let Some(t) = args.get("type").and_then(Value::as_str) {
                items.retain(|it| it.item.item_type == t);
            }
            let total = items.len();
            items.truncate(limit);
            ToolResult::Ok(json!({
                "total": total,
                "items": items.iter().map(brief_item).collect::<Vec<_>>(),
            }))
        }
        "get_item" => {
            let Some(id) = args.get("id").and_then(json_i64) else {
                return ToolResult::Err("缺少参数 id".to_string());
            };
            match item_service::get_item(&conn, id) {
                Ok(item) => ToolResult::Ok(json!(item)),
                Err(e) => ToolResult::Err(e),
            }
        }
        "overview" => {
            let stats = match super::collect_stats(&conn) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            let tags = match tag_service::get_tags(&conn) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            let cabinets = match cabinet_service::get_cabinets(&conn) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            ToolResult::Ok(json!({
                "stats": stats,
                "tags": tags.iter().map(|t| json!({ "id": t.id, "name": t.name })).collect::<Vec<_>>(),
                "cabinets": cabinets
                    .iter()
                    .map(|c| match &c.folder_path {
                        Some(folder) => json!({ "id": c.id, "name": c.name, "folder": folder }),
                        None => json!({ "id": c.id, "name": c.name }),
                    })
                    .collect::<Vec<_>>(),
            }))
        }
        "launch_item" => {
            let id = if let Some(id) = args.get("id").and_then(json_i64) {
                id
            } else if let Some(q) = args.get("query").and_then(Value::as_str) {
                match search_service::search_items(&conn, q, &[]) {
                    Ok(items) => match items.first() {
                        Some(it) => it.item.id,
                        None => return ToolResult::Err(format!("没有找到匹配「{q}」的对象")),
                    },
                    Err(e) => return ToolResult::Err(e),
                }
            } else {
                return ToolResult::Err("launch_item 需要 id 或 query 参数".to_string());
            };
            match launch_service::launch_item(&conn, id) {
                Ok(()) => ToolResult::Ok(json!({ "launched": id })),
                Err(e) => ToolResult::Err(e),
            }
        }
        "add_items" => {
            let paths: Vec<String> = args
                .get("paths")
                .and_then(Value::as_array)
                .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            if paths.is_empty() {
                return ToolResult::Err("add_items 需要 paths 数组".to_string());
            }
            drop(conn);
            let result = item_service::add_items(db, paths);
            ToolResult::Ok(json!({
                "created": result.created_count,
                "touched": result.items.len(),
                "failed": result.failed,
            }))
        }
        "remove_items" => {
            let ids: Vec<i64> = json_i64_vec(args.get("ids"));
            if ids.is_empty() {
                return ToolResult::Err("remove_items 需要 ids 数组".to_string());
            }
            match item_service::remove_items(&conn, &ids) {
                Ok(()) => ToolResult::Ok(json!({ "removed": ids })),
                Err(e) => ToolResult::Err(e),
            }
        }
        "add_tag" => {
            let Some(name) = args.get("name").and_then(Value::as_str) else {
                return ToolResult::Err("缺少参数 name".to_string());
            };
            let color = args.get("color").and_then(Value::as_str).unwrap_or(DEFAULT_TAG_COLOR);
            match tag_service::add_tag(&conn, name, color) {
                Ok(tag) => ToolResult::Ok(json!(tag)),
                Err(e) => ToolResult::Err(e),
            }
        }
        "set_item_tags" => {
            let Some(item_id) = args.get("item_id").and_then(json_i64) else {
                return ToolResult::Err("缺少参数 item_id".to_string());
            };
            let names = json_str_vec(args.get("tag_names"));
            let create_missing = args.get("create_missing").and_then(Value::as_bool).unwrap_or(false);
            // 先确认对象存在，避免 id 错误时留下新建的空标签
            if let Err(e) = item_service::get_item(&conn, item_id) {
                return ToolResult::Err(e);
            }
            let mut all = match tag_service::get_tags(&conn) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            let mut ids = Vec::new();
            let mut created = Vec::new();
            for name in &names {
                let id = match find_tag(&all, name) {
                    Some(tag) => tag.id,
                    None if create_missing => match tag_service::add_tag(&conn, name, DEFAULT_TAG_COLOR) {
                        Ok(tag) => {
                            created.push(tag.name.clone());
                            let id = tag.id;
                            all.push(tag);
                            id
                        }
                        Err(e) => return ToolResult::Err(e),
                    },
                    None => return ToolResult::Err(format!("标签「{name}」不存在")),
                };
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            match tag_service::set_item_tags(&conn, item_id, &ids) {
                Ok(()) => ToolResult::Ok(json!({ "item": item_id, "tags": ids, "created": created })),
                Err(e) => ToolResult::Err(e),
            }
        }
        "set_favorite" => {
            let ids: Vec<i64> = json_i64_vec(args.get("ids"));
            let favorite = args.get("favorite").and_then(Value::as_bool).unwrap_or(true);
            if ids.is_empty() {
                return ToolResult::Err("set_favorite 需要 ids 数组".to_string());
            }
            match item_service::set_favorites(&conn, &ids, favorite) {
                Ok(()) => ToolResult::Ok(json!({ "ids": ids, "favorite": favorite })),
                Err(e) => ToolResult::Err(e),
            }
        }
        _ => ToolResult::Err(format!("未知工具: {name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 工具清单合法：名称唯一、均带 inputSchema。
    #[test]
    fn tool_definitions_are_well_formed() {
        let tools = tool_definitions();
        let arr = tools.as_array().expect("tools 应为数组");
        assert!(!arr.is_empty());
        let mut names = std::collections::HashSet::new();
        for t in arr {
            let name = t["name"].as_str().expect("工具缺 name");
            assert!(names.insert(name), "工具名重复: {name}");
            assert!(t["inputSchema"]["type"].as_str() == Some("object"), "{name} 缺 object schema");
            assert!(t["description"].as_str().is_some_and(|d| !d.is_empty()), "{name} 缺描述");
        }
    }

    /// 未知工具走 isError 通道而非协议级错误。
    #[test]
    fn unknown_tool_returns_tool_error() {
        let resp = ToolResult::Err("未知工具: nope".to_string()).to_response(&json!(1));
        assert_eq!(resp["result"]["isError"], json!(true));
        assert!(resp["error"].is_null(), "工具错误不应使用 JSON-RPC error 字段");
    }

    #[test]
    fn json_i64_accepts_number_string_and_whole_float() {
        assert_eq!(json_i64(&json!(42)), Some(42));
        assert_eq!(json_i64(&json!("42")), Some(42));
        assert_eq!(json_i64(&json!(42.0)), Some(42));
        assert_eq!(json_i64(&json!("x")), None);
        assert_eq!(json_i64(&json!(1.5)), None);
        assert_eq!(json_i64_vec(Some(&json!(["1", 2, 3.0]))), vec![1, 2, 3]);
    }

    #[test]
    fn tool_definitions_cover_merged_surface() {
        let tools = tool_definitions();
        let names: Vec<&str> = tools
            .as_array()
            .expect("tools")
            .iter()
            .filter_map(|t| t["name"].as_str())
            .collect();
        assert_eq!(
            names,
            [
                "search_items", "get_item", "overview", "launch_item", "add_items",
                "remove_items", "add_tag", "set_item_tags", "set_favorite",
            ]
        );
        for t in tools.as_array().expect("tools") {
            assert!(t["annotations"].is_object(), "{} 缺 annotations", t["name"]);
        }
    }

    #[test]
    fn negotiate_version_echoes_supported_and_defaults_to_latest() {
        assert_eq!(negotiate_version(Some("2024-11-05")), "2024-11-05");
        assert_eq!(negotiate_version(Some("2025-06-18")), "2025-06-18");
        assert_eq!(negotiate_version(Some("2099-01-01")), PROTOCOL_VERSIONS[0]);
        assert_eq!(negotiate_version(None), PROTOCOL_VERSIONS[0]);
    }

    /// 进程内 MCP 工具面：mock 视频文件入库后走一遍查询、标签与概览。
    #[test]
    fn call_tool_e2e_with_mock_video_file() {
        use crate::db::Database;
        use crate::services::item_service;

        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tl_mcp_e2e_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let db = Database::new(&dir.join("taglauncher.db")).expect("open db");
        let mp4 = dir.join("clip.mp4");
        std::fs::write(&mp4, b"mock-mp4").expect("write mock video");

        let item = {
            let conn = db.get_conn();
            item_service::add_item(&conn, &mp4.to_string_lossy()).expect("add mock mp4")
        };
        assert_eq!(item.item_type, "video");

        let ok = |name: &str, args: Value| match call_tool(&db, name, &args) {
            ToolResult::Ok(v) => v,
            ToolResult::Err(e) => panic!("{name}: {e}"),
        };

        let v = ok("get_item", json!({ "id": item.id.to_string() }));
        assert_eq!(v["id"], item.id);
        assert_eq!(v["type"], "video");
        assert!(v.get("created_at").is_some(), "get_item 保留完整字段");

        let v = ok("search_items", json!({ "query": "clip", "type": "video" }));
        assert_eq!(v["total"], 1);
        let brief = &v["items"][0];
        assert_eq!(brief["id"], item.id);
        assert_eq!(brief["tags"], json!([]));
        assert!(brief.get("created_at").is_none() && brief.get("favorite").is_none());

        let v = ok("search_items", json!({ "limit": 0 }));
        assert_eq!(v["total"], 1, "空条件列出全部");
        assert_eq!(v["items"], json!([]));

        let v = ok("search_items", json!({ "cabinet_id": "99" }));
        assert_eq!(v["total"], 0);

        // 对象 id 错误：报错且不新建标签
        assert!(matches!(
            call_tool(&db, "set_item_tags", &json!({ "item_id": 999_999, "tag_names": ["新标签"], "create_missing": true })),
            ToolResult::Err(_)
        ));
        // 默认不自动建标签
        assert!(matches!(
            call_tool(&db, "set_item_tags", &json!({ "item_id": item.id, "tag_names": ["新标签"] })),
            ToolResult::Err(_)
        ));
        assert_eq!(ok("overview", json!({}))["tags"], json!([]));

        let v = ok(
            "set_item_tags",
            json!({ "item_id": item.id, "tag_names": ["新标签", "新标签"], "create_missing": true }),
        );
        assert_eq!(v["created"], json!(["新标签"]));
        assert_eq!(v["tags"].as_array().map(|a| a.len()), Some(1));

        let v = ok("search_items", json!({ "tags": ["新标签"] }));
        assert_eq!(v["items"][0]["tags"], json!(["新标签"]));
        assert!(matches!(
            call_tool(&db, "search_items", &json!({ "tags": ["不存在"] })),
            ToolResult::Err(_)
        ));

        let v = ok("overview", json!({}));
        assert!(v["stats"]["items"].as_i64().unwrap_or(0) >= 1);
        assert_eq!(v["tags"][0]["name"], "新标签");
        assert_eq!(v["cabinets"], json!([]));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

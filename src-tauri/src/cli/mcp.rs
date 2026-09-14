//! 极简 MCP（Model Context Protocol）stdio server。
//!
//! 协议面锁定在 tools 子集：initialize / notifications/initialized / ping /
//! tools/list / tools/call，newline-delimited JSON-RPC 2.0（每行一条消息）。
//! 工具实现与 tl CLI 共用同一服务层，行为与 GUI 一致。
//!
//! 不引异步运行时：MCP stdio 是严格的请求-响应回环，同步逐行处理即可。

use crate::db::Database;
use crate::services::{
    cabinet_service, item_service, launch_service, search_service, tag_service,
};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";

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
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "tag-launcher",
                        "version": env!("CARGO_PKG_VERSION"),
                    }
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
                let text = serde_json::to_string_pretty(v).unwrap_or_else(|_| v.to_string());
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
    json!([
        {
            "name": "search_items",
            "description": "按关键词全文搜索 TagLauncher 中的对象（文件/文件夹/应用等），可按类型过滤。返回 id、名称、路径、类型、标签。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "搜索关键词（名称/路径）" },
                    "type": { "type": "string", "description": "类型过滤：folder/image/audio/video/exe/bat/ps1", "enum": ["folder", "image", "audio", "video", "exe", "bat", "ps1"] },
                    "limit": { "type": "integer", "description": "最大返回条数，默认 50" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "list_items",
            "description": "列出 TagLauncher 中的全部对象。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "description": "最大返回条数，默认 200" }
                }
            }
        },
        {
            "name": "get_item",
            "description": "按 id 查看单个对象的完整信息。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "integer" } },
                "required": ["id"]
            }
        },
        {
            "name": "launch_item",
            "description": "启动（打开）一个对象：按 id 或搜索词首命中。等价于在系统中双击打开。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "对象 id（优先）" },
                    "query": { "type": "string", "description": "无 id 时按搜索词首命中启动" }
                }
            }
        },
        {
            "name": "add_items",
            "description": "把文件/文件夹添加进 TagLauncher 管理。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "绝对路径数组" }
                },
                "required": ["paths"]
            }
        },
        {
            "name": "remove_items",
            "description": "从 TagLauncher 移除对象（不删除磁盘文件）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": { "type": "array", "items": { "type": "integer" } }
                },
                "required": ["ids"]
            }
        },
        {
            "name": "list_tags",
            "description": "列出全部标签。",
            "inputSchema": { "type": "object", "properties": {} }
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
            }
        },
        {
            "name": "set_item_tags",
            "description": "设置对象的标签（整体替换；标签名须已存在）。传空数组即清空。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "item_id": { "type": "integer" },
                    "tag_names": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["item_id", "tag_names"]
            }
        },
        {
            "name": "set_favorite",
            "description": "收藏或取消收藏对象。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": { "type": "array", "items": { "type": "integer" } },
                    "favorite": { "type": "boolean" }
                },
                "required": ["ids", "favorite"]
            }
        },
        {
            "name": "list_cabinets",
            "description": "列出全部文件柜。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_cabinet_items",
            "description": "列出指定文件柜内的对象。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "文件柜 id" }
                },
                "required": ["id"]
            }
        },
        {
            "name": "stats",
            "description": "库概览统计（对象/标签/文件柜数量、按类型分布）。",
            "inputSchema": { "type": "object", "properties": {} }
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

fn call_tool(db: &Database, name: &str, args: &Value) -> ToolResult {
    let conn = db.get_conn();
    match name {
        "search_items" => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let mut items = match search_service::search_items(&conn, query, &[]) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            if let Some(t) = args.get("type").and_then(Value::as_str) {
                items.retain(|it| it.item.item_type == t);
            }
            items.truncate(limit);
            ToolResult::Ok(json!(items))
        }
        "list_items" => {
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(200) as usize;
            match item_service::get_items(&conn) {
                Ok(mut items) => {
                    items.truncate(limit);
                    ToolResult::Ok(json!(items))
                }
                Err(e) => ToolResult::Err(e),
            }
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
        "list_tags" => match tag_service::get_tags(&conn) {
            Ok(tags) => ToolResult::Ok(json!(tags)),
            Err(e) => ToolResult::Err(e),
        },
        "add_tag" => {
            let Some(name) = args.get("name").and_then(Value::as_str) else {
                return ToolResult::Err("缺少参数 name".to_string());
            };
            let color = args.get("color").and_then(Value::as_str).unwrap_or("#3b82f6");
            match tag_service::add_tag(&conn, name, color) {
                Ok(tag) => ToolResult::Ok(json!(tag)),
                Err(e) => ToolResult::Err(e),
            }
        }
        "set_item_tags" => {
            let Some(item_id) = args.get("item_id").and_then(json_i64) else {
                return ToolResult::Err("缺少参数 item_id".to_string());
            };
            let names: Vec<String> = args
                .get("tag_names")
                .and_then(Value::as_array)
                .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            let all = match tag_service::get_tags(&conn) {
                Ok(v) => v,
                Err(e) => return ToolResult::Err(e),
            };
            let mut ids = Vec::new();
            for name in &names {
                match all.iter().find(|t| t.name.eq_ignore_ascii_case(name)) {
                    Some(tag) => ids.push(tag.id),
                    None => return ToolResult::Err(format!("标签「{name}」不存在")),
                }
            }
            match tag_service::set_item_tags(&conn, item_id, &ids) {
                Ok(()) => ToolResult::Ok(json!({ "item": item_id, "tags": ids })),
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
        "list_cabinets" => match cabinet_service::get_cabinets(&conn) {
            Ok(cabinets) => ToolResult::Ok(json!(cabinets)),
            Err(e) => ToolResult::Err(e),
        },
        "list_cabinet_items" => {
            let Some(id) = args.get("id").and_then(json_i64) else {
                return ToolResult::Err("缺少参数 id".to_string());
            };
            match cabinet_service::get_cabinet_items(&conn, id) {
                Ok(items) => ToolResult::Ok(json!(items)),
                Err(e) => ToolResult::Err(e),
            }
        },
        "stats" => match super::collect_stats(&conn) {
            Ok(stats) => ToolResult::Ok(json!(stats)),
            Err(e) => ToolResult::Err(e),
        },
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
    fn tool_definitions_include_list_cabinet_items() {
        let tools = tool_definitions();
        let names: Vec<&str> = tools
            .as_array()
            .expect("tools")
            .iter()
            .filter_map(|t| t["name"].as_str())
            .collect();
        assert!(names.contains(&"list_cabinet_items"));
    }

    /// 进程内 MCP 工具面：mock 视频文件入库后，字符串 id / stats / 空柜列表均可调用。
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

        match call_tool(&db, "get_item", &json!({ "id": item.id.to_string() })) {
            ToolResult::Ok(v) => {
                assert_eq!(v["id"], item.id);
                assert_eq!(v["type"], "video");
            }
            ToolResult::Err(e) => panic!("get_item: {e}"),
        }

        match call_tool(&db, "search_items", &json!({ "query": "clip", "type": "video" })) {
            ToolResult::Ok(v) => {
                let arr = v.as_array().expect("search array");
                assert!(arr.iter().any(|it| it["id"] == item.id));
            }
            ToolResult::Err(e) => panic!("search_items: {e}"),
        }

        match call_tool(&db, "list_cabinet_items", &json!({ "id": "99" })) {
            ToolResult::Ok(v) => assert_eq!(v.as_array().map(|a| a.len()), Some(0)),
            ToolResult::Err(e) => panic!("list_cabinet_items: {e}"),
        }

        match call_tool(&db, "stats", &json!({})) {
            ToolResult::Ok(v) => assert!(v["items"].as_i64().unwrap_or(0) >= 1),
            ToolResult::Err(e) => panic!("stats: {e}"),
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}

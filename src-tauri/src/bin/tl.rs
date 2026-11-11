//! tl —— TagLauncher 全功能命令行。
//!
//! 直连与 GUI 相同的 SQLite 实库（WAL 下并发安全），覆盖搜索/启动/标签/收藏/
//! 文件柜等核心功能；`--json` 全局开关输出机器可读 JSON，供脚本与 AI 消费。

use clap::{Parser, Subcommand};
use tag_launcher_lib::cli;
use tag_launcher_lib::models::{Cabinet, ItemWithTags};
use tag_launcher_lib::services::{
    cabinet_service, item_service, launch_service, search_service, tag_service,
};

#[derive(Parser)]
#[command(name = "tl", version, about = "TagLauncher 命令行（与 GUI 共享同一数据库）")]
struct CliArgs {
    /// 输出 JSON（供脚本 / AI 消费）
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 搜索对象（数据库全文搜索）
    Search {
        query: String,
        /// 类型过滤：folder / image / audio / video / exe / bat / ps1 / text
        #[arg(long = "type")]
        type_filter: Option<String>,
        #[arg(long, default_value = "50")]
        limit: usize,
    },
    /// 列出全部对象
    List {
        #[arg(long, default_value = "200")]
        limit: usize,
    },
    /// 查看单个对象详情
    Get { id: i64 },
    /// 添加文件 / 文件夹（可多个）
    Add { paths: Vec<String> },
    /// 从应用中移除对象（不删除磁盘文件）
    Remove { ids: Vec<i64> },
    /// 启动对象：数字按 id，否则按搜索词首命中
    Launch { target: String },
    /// 标签管理
    #[command(subcommand)]
    Tag(TagCmd),
    /// 收藏 / 取消收藏对象
    Fav {
        ids: Vec<i64>,
        /// 取消收藏
        #[arg(long)]
        off: bool,
    },
    /// 文件柜
    #[command(subcommand)]
    Cabinet(CabinetCmd),
    /// 库概览统计
    Stats,
    /// 终端交互界面（搜索 + 启动 + 收藏）
    Tui,
}

#[derive(Subcommand)]
enum TagCmd {
    /// 列出全部标签
    List,
    /// 新建标签
    Add { name: String, #[arg(long, default_value = "#3b82f6")] color: String },
    /// 设置对象的标签（整体替换；标签名须已存在）
    Set { item_id: i64, names: Vec<String> },
    /// 清空对象的标签
    Clear { item_id: i64 },
}

#[derive(Subcommand)]
enum CabinetCmd {
    /// 列出全部文件柜（按嵌套层级缩进）
    List,
    /// 列出柜内对象（默认含全部子柜，与界面父柜视图一致）
    Items {
        id: i64,
        /// 仅本柜，不含子柜
        #[arg(long)]
        only_self: bool,
    },
    /// 移动文件柜到另一个柜下（不给 --parent 则移到顶层）
    Move {
        id: i64,
        #[arg(long)]
        parent: Option<i64>,
    },
}

/// 把共享代码里的 log 记录原样打印到 stderr（GUI 由 tauri-plugin-log 写日志文件）。
struct StderrLogger;

impl log::Log for StderrLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{}", record.args());
        }
    }

    fn flush(&self) {}
}

fn main() {
    if log::set_logger(&StderrLogger).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    let args = CliArgs::parse();
    if let Err(e) = run(args) {
        eprintln!("错误: {e}");
        std::process::exit(1);
    }
}

fn run(args: CliArgs) -> Result<(), String> {
    let json = args.json;
    match args.command {
        Cmd::Tui => return cli::tui::run(),
        Cmd::Search { query, type_filter, limit } => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            let mut items = search_service::search_items(&conn, &query, &[])?;
            drop(conn);
            if let Some(t) = type_filter {
                items.retain(|it| it.item.item_type == t);
            }
            items.truncate(limit);
            print_items(&items, json)?;
        }
        Cmd::List { limit } => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            let mut items = item_service::get_items(&conn)?;
            drop(conn);
            items.truncate(limit);
            print_items(&items, json)?;
        }
        Cmd::Get { id } => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            let item = item_service::get_item(&conn, id)?;
            drop(conn);
            if json {
                println!("{}", serde_json::to_string_pretty(&item).map_err(|e| e.to_string())?);
            } else {
                print_items(&[item], false)?;
            }
        }
        Cmd::Add { paths } => {
            if paths.is_empty() {
                return Err("add 需要至少一个路径".to_string());
            }
            let db = cli::open_db()?;
            let result = item_service::add_items(&db, paths);
            if json {
                let out = serde_json::json!({
                    "created": result.created_count,
                    "touched": result.items.len(),
                    "failed": result.failed,
                });
                println!("{}", serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?);
            } else {
                println!("处理 {} 个路径：新建 {}，失败 {}", result.items.len(), result.created_count, result.failed.len());
                for f in &result.failed {
                    eprintln!("  失败: {} ({})", f.path, f.error);
                }
            }
            // 部分失败也按错误退出（退出码 1、stderr「错误: …」），与其它子命令约定一致；
            // --json 时 stdout 仍是完整结果（含 failed 明细），脚本可据退出码判断后再读明细。
            if !result.failed.is_empty() {
                return Err(format!("{} 个路径添加失败（共 {} 个）", result.failed.len(), result.failed.len() + result.items.len()));
            }
        }
        Cmd::Remove { ids } => {
            if ids.is_empty() {
                return Err("remove 需要至少一个 id".to_string());
            }
            let db = cli::open_db()?;
            let conn = db.get_conn();
            item_service::remove_items(&conn, &ids)?;
            drop(conn);
            if json {
                println!("{}", serde_json::to_string(&serde_json::json!({ "removed": ids })).map_err(|e| e.to_string())?);
            } else {
                println!("已移除 {} 个对象", ids.len());
            }
        }
        Cmd::Launch { target } => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            let id = match target.parse::<i64>() {
                Ok(id) => id,
                Err(_) => {
                    let items = search_service::search_items(&conn, &target, &[])?;
                    items
                        .first()
                        .map(|it| it.item.id)
                        .ok_or_else(|| format!("没有找到匹配「{target}」的对象"))?
                }
            };
            let name = item_service::get_item(&conn, id)?.item.name;
            launch_service::launch_item(&conn, id)?;
            drop(conn);
            if json {
                println!("{}", serde_json::to_string(&serde_json::json!({ "launched": id })).map_err(|e| e.to_string())?);
            } else {
                println!("已启动 #{id} {name}");
            }
        }
        Cmd::Tag(tag_cmd) => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            match tag_cmd {
                TagCmd::List => {
                    let tags = tag_service::get_tags(&conn)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&tags).map_err(|e| e.to_string())?);
                    } else {
                        for t in &tags {
                            println!("#{}\t{}\t{}", t.id, t.name, t.color);
                        }
                    }
                }
                TagCmd::Add { name, color } => {
                    let tag = tag_service::add_tag(&conn, &name, &color)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&tag).map_err(|e| e.to_string())?);
                    } else {
                        println!("已创建标签 #{} {}", tag.id, tag.name);
                    }
                }
                TagCmd::Set { item_id, names } => {
                    let all = tag_service::get_tags(&conn)?;
                    let mut ids = Vec::new();
                    for name in &names {
                        let tag = all
                            .iter()
                            .find(|t| t.name.eq_ignore_ascii_case(name))
                            .ok_or_else(|| format!("标签「{name}」不存在（用 tl tag add 先创建）"))?;
                        ids.push(tag.id);
                    }
                    tag_service::set_item_tags(&conn, item_id, &ids)?;
                    if json {
                        println!("{}", serde_json::to_string(&serde_json::json!({ "item": item_id, "tags": ids })).map_err(|e| e.to_string())?);
                    } else {
                        println!("已设置对象 #{item_id} 的标签：{}", names.join(", "));
                    }
                }
                TagCmd::Clear { item_id } => {
                    tag_service::set_item_tags(&conn, item_id, &[])?;
                    if json {
                        let empty: Vec<i64> = Vec::new();
                        println!("{}", serde_json::to_string(&serde_json::json!({ "item": item_id, "tags": empty })).map_err(|e| e.to_string())?);
                    } else {
                        println!("已清空对象 #{item_id} 的标签");
                    }
                }
            }
        }
        Cmd::Fav { ids, off } => {
            if ids.is_empty() {
                return Err("fav 需要至少一个 id".to_string());
            }
            let db = cli::open_db()?;
            let conn = db.get_conn();
            item_service::set_favorites(&conn, &ids, !off)?;
            drop(conn);
            if json {
                println!("{}", serde_json::to_string(&serde_json::json!({ "ids": ids, "favorite": !off })).map_err(|e| e.to_string())?);
            } else {
                println!("已{} {} 个对象", if off { "取消收藏" } else { "收藏" }, ids.len());
            }
        }
        Cmd::Cabinet(cabinet_cmd) => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            match cabinet_cmd {
                CabinetCmd::List => {
                    let cabinets = cabinet_service::get_cabinets(&conn)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&cabinets).map_err(|e| e.to_string())?);
                    } else {
                        for (c, depth) in cabinet_tree(&cabinets) {
                            println!("{}#{}\t{}", "  ".repeat(depth), c.id, c.name);
                        }
                    }
                }
                CabinetCmd::Items { id, only_self } => {
                    let items = cabinet_service::get_cabinet_items(&conn, id, !only_self)?;
                    print_items(&items, json)?;
                }
                CabinetCmd::Move { id, parent } => {
                    cabinet_service::set_cabinet_parent(&conn, id, parent)?;
                    match parent {
                        Some(p) => println!("已把文件柜 #{id} 移到 #{p} 下"),
                        None => println!("已把文件柜 #{id} 移到顶层"),
                    }
                }
            }
        }
        Cmd::Stats => {
            let db = cli::open_db()?;
            let conn = db.get_conn();
            let stats = cli::collect_stats(&conn)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&stats).map_err(|e| e.to_string())?);
            } else {
                println!("对象 {}（收藏 {}）· 标签 {} · 文件柜 {}", stats.items, stats.favorites, stats.tags, stats.cabinets);
                for (t, n) in &stats.by_type {
                    println!("  {t}: {n}");
                }
            }
        }
    }
    Ok(())
}

/// 文件柜按父子关系深度优先展开（同级保持 get_cabinets 的顺序）；父不存在或成环的柜按顶层输出。
fn cabinet_tree(cabinets: &[Cabinet]) -> Vec<(&Cabinet, usize)> {
    let ids: std::collections::HashSet<i64> = cabinets.iter().map(|c| c.id).collect();
    let mut out = Vec::with_capacity(cabinets.len());
    let mut seen = std::collections::HashSet::new();
    fn walk<'a>(
        all: &'a [Cabinet],
        parent: Option<i64>,
        depth: usize,
        ids: &std::collections::HashSet<i64>,
        seen: &mut std::collections::HashSet<i64>,
        out: &mut Vec<(&'a Cabinet, usize)>,
    ) {
        for c in all {
            let p = c.parent_id.filter(|p| ids.contains(p));
            if p == parent && seen.insert(c.id) {
                out.push((c, depth));
                walk(all, Some(c.id), depth + 1, ids, seen, out);
            }
        }
    }
    walk(cabinets, None, 0, &ids, &mut seen, &mut out);
    for c in cabinets {
        if seen.insert(c.id) {
            out.push((c, 0));
        }
    }
    out
}

fn print_items(items: &[ItemWithTags], json: bool) -> Result<(), String> {
    if json {
        println!("{}", serde_json::to_string_pretty(items).map_err(|e| e.to_string())?);
        return Ok(());
    }
    for it in items {
        let tags = it.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(",");
        println!("#{}\t{}\t{}\t{}\t{}", it.item.id, it.item.item_type, it.item.name, tags, it.item.path);
    }
    Ok(())
}

use crate::db::Database;
use crate::models::ItemWithTags;
use crate::services::{item_service, search_service};
use tauri::{AppHandle, State};

// fill_visuals 在图标未缓存时会跑 PowerShell/文件 IO，同步命令会在主线程执行而冻结 UI，
// 与 get_items 一致用 (async) 放到工作线程。函数体全同步（无 await），无跨 await 持锁。
#[tauri::command(async)]
pub fn search_items(
    app: AppHandle,
    db: State<Database>,
    query: String,
    tag_ids: Vec<i64>,
    include_descendants: Option<bool>,
) -> Result<Vec<ItemWithTags>, String> {
    // 锁内查询，锁外补图标，避免持锁期间执行图标提取等重 IO。
    let mut items = {
        let conn = db.get_conn();
        search_service::search_items_filtered(
            &conn,
            &query,
            &tag_ids,
            include_descendants.unwrap_or(true),
        )?
    };
    item_service::fill_visuals(&app, &mut items);
    crate::services::asset_scope::allow_items(&app, &items);
    Ok(items)
}

// ---------------------------------------------------------------- 内存索引搜索（主窗 + 快速窗）

use crate::services::search_index::{IndexStats, SearchIndex, SearchParams};
use crate::services::synonym_service;
use serde::Serialize;

fn synonyms_loader(app: &AppHandle) -> impl Fn() -> Vec<Vec<String>> + '_ {
    move || {
        synonym_service::read_synonyms(app).unwrap_or_else(|e| {
            log::warn!("读取同义词失败，本次按无同义词搜索：{e}");
            Vec::new()
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSearchResult {
    /// 命中总数（items 只含前 limit 条）
    pub total: usize,
    /// 索引里的对象总数（输入框占位提示用）
    pub indexed: usize,
    pub items: Vec<ItemWithTags>,
}

/// 快速窗搜索：只返回前 `limit`（默认 50）条对象。空查询 = 默认排序（收藏 → 最近使用 → 名称）的前若干项。
#[tauri::command(async)]
pub fn quick_search(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
    query: String,
    mode: Option<String>,
    hide_missing: Option<bool>,
    limit: Option<usize>,
) -> Result<QuickSearchResult, String> {
    let params = SearchParams {
        query,
        mode: mode.unwrap_or_default(),
        scope: None,
        type_filter: String::new(),
        hide_missing: hide_missing.unwrap_or(false),
    };
    let ro = db.read_conn()?;
    let ids = index.search(ro.conn(), &params, &synonyms_loader(&app))?;
    let top: Vec<i64> = ids.iter().take(limit.unwrap_or(50)).copied().collect();
    let mut by_id: std::collections::HashMap<i64, ItemWithTags> =
        item_service::get_items_by_ids(ro.conn(), &top)?
            .into_iter()
            .map(|it| (it.item.id, it))
            .collect();
    let items = top.iter().filter_map(|id| by_id.remove(id)).collect();
    Ok(QuickSearchResult {
        total: ids.len(),
        indexed: index.stats().entries,
        items,
    })
}

/// 预建索引（主窗首屏加载后、快速窗预创建时调用），让第一次搜索不承担建索引耗时。
#[tauri::command(async)]
pub fn search_warm(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
) -> Result<IndexStats, String> {
    let ro = db.read_conn()?;
    index.warm(ro.conn(), &synonyms_loader(&app))?;
    Ok(index.stats())
}

/// 索引统计（条目数、重建次数与耗时、估算内存），供诊断与 E2E。
#[tauri::command]
pub fn search_index_stats(index: State<SearchIndex>) -> IndexStats {
    index.stats()
}

// ---------------------------------------------------------------- 主窗视图（分页：只传 ID，数据按页取）

use crate::services::cabinet_service;
use crate::services::search_index::{LibraryStats, ViewRequest, ViewResponse};
use crate::view::{Scope, ViewParams};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewQueryArgs {
    /// "all" | "favorites" | "recent" | "cabinet"
    pub scope: String,
    pub cabinet_id: Option<i64>,
    #[serde(default)]
    pub selected_groups: Vec<Vec<i64>>,
    #[serde(default)]
    pub excluded_groups: Vec<Vec<i64>>,
    #[serde(default)]
    pub type_filter: String,
    #[serde(default)]
    pub hide_missing: bool,
    #[serde(default)]
    pub sort_mode: String,
    #[serde(default)]
    pub show_nested_contents: bool,
    pub library_browse_root: Option<String>,
    pub library_browse_dir: Option<String>,
    pub cabinet_dir: Option<String>,
    #[serde(default)]
    pub cabinet_flat: bool,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub mode: String,
    /// 显式重排点（全量刷新 / 排序或视图域切换）：重拍 smart 排序的冻结键
    #[serde(default)]
    pub refreeze: bool,
}

/// 主窗当前视图的全部 ID（已筛选排序；搜索时按命中排序）。对象数据由前端按可视区间经
/// `get_items_page` 分页取，总数、全选、批量与定位都基于这份 ID。
#[tauri::command(async)]
pub fn view_query(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
    args: ViewQueryArgs,
) -> Result<ViewResponse, String> {
    let ro = db.read_conn()?;
    let req = view_request(ro.conn(), args)?;
    index.view(ro.conn(), &req, &synonyms_loader(&app))
}

/// 主窗 typeahead：在与 `view_query` 同参数的视图里找名称（小写）前缀/子串命中的首项。
#[tauri::command(async)]
pub fn view_typeahead(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
    args: ViewQueryArgs,
    text: String,
) -> Result<Option<i64>, String> {
    let ro = db.read_conn()?;
    let req = view_request(ro.conn(), args)?;
    index.typeahead(ro.conn(), &req, &text, &synonyms_loader(&app))
}

fn view_request(conn: &rusqlite::Connection, args: ViewQueryArgs) -> Result<ViewRequest, String> {
    let scope = match args.scope.as_str() {
        "favorites" => Scope::Favorites,
        "recent" => Scope::Recent,
        "cabinet" => {
            let id = args.cabinet_id.ok_or("cabinet 视图缺少 cabinetId")?;
            let (members, linked_folder) = cabinet_service::cabinet_member_ids(conn, id)?;
            Scope::Cabinet {
                members,
                linked_folder,
            }
        }
        _ => Scope::All,
    };
    Ok(ViewRequest {
        params: ViewParams {
            scope,
            selected_groups: args.selected_groups,
            excluded_groups: args.excluded_groups,
            type_filter: if args.type_filter.is_empty() {
                "all".into()
            } else {
                args.type_filter
            },
            hide_missing: args.hide_missing,
            sort_mode: args.sort_mode,
            show_nested_contents: args.show_nested_contents,
            library_browse_root: args.library_browse_root,
            library_browse_dir: args.library_browse_dir,
            cabinet_dir: args.cabinet_dir,
            cabinet_flat: args.cabinet_flat,
            has_search: false,
        },
        query: args.query,
        mode: args.mode,
        refreeze: args.refreeze,
    })
}

/// 侧栏/状态栏计数：总数、收藏、最近使用、未打标、失效 ID 与各标签计数。
/// `tag_groups`：(标签, 自身 ∪ 后代)，与侧栏「选父标签并入后代」口径一致。
#[tauri::command(async)]
pub fn library_stats(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
    tag_groups: Vec<(i64, Vec<i64>)>,
) -> Result<LibraryStats, String> {
    let ro = db.read_conn()?;
    index.library_stats(ro.conn(), &tag_groups, &synonyms_loader(&app))
}

/// 主窗「打开」对象时的逐级浏览落点（文件夹有库内后代 → 进入；隐藏对象 → 所在目录）。
/// 无需逐级浏览时返回 None，前端照常启动。
#[tauri::command(async)]
pub fn browse_target(
    db: State<Database>,
    id: i64,
) -> Result<Option<crate::view::browse::BrowseTarget>, String> {
    use crate::view::browse::{browse_target, PathEntry};
    let ro = db.read_conn()?;
    let conn = ro.conn();
    let mut stmt = conn
        .prepare("SELECT id, path, type, hide_from_all, is_missing FROM items")
        .map_err(|e| e.to_string())?;
    let mut target: Option<(PathEntry, bool)> = None;
    let mut items = Vec::new();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                PathEntry {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    is_folder: r.get::<_, String>(2)? == "folder",
                    hide_from_all: r.get::<_, i64>(3)? != 0,
                },
                r.get::<_, i64>(4)? != 0,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (entry, missing) = row.map_err(|e| e.to_string())?;
        if entry.id == id {
            target = Some((entry.clone(), missing));
        }
        items.push(entry);
    }
    Ok(target.and_then(|(item, missing)| browse_target(&item, missing, &items)))
}

/// 主窗取页：按 ID 从内存索引组装对象（不含自动图标，与 `get_items_by_ids(.., false)` 同形），
/// 走只读连接校验新鲜度，不经写连接、不跑 SQL 取行，滚动跳转时少一段等待。
#[tauri::command(async)]
pub fn get_items_page(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
    ids: Vec<i64>,
    warm: Option<bool>,
) -> Result<Vec<ItemWithTags>, String> {
    let items = {
        let ro = db.read_conn()?;
        index.items_page(ro.conn(), &ids, &synonyms_loader(&app))?
    };
    // 空闲补齐（warm）只放行卡片直接显示的路径；预览命令读取前按需放行其余范围
    if warm.unwrap_or(false) {
        crate::services::asset_scope::allow_items_for_cards(&app, &items);
    } else {
        crate::services::asset_scope::allow_items(&app, &items);
    }
    Ok(items)
}

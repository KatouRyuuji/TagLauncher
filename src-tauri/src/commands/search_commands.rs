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
pub struct SearchQueryResult {
    /// 全部命中 ID（已排序、已筛选）：主窗据此取总数、全选、批量操作与定位
    pub ids: Vec<i64>,
}

/// 主窗搜索：返回全部命中 ID（数据本体主窗已有，不重复传输）。
/// `scope_ids` 给出时只在这些对象里搜，并以其顺序为基础顺序（文件柜/收藏/最近/标签筛选）。
#[tauri::command(async)]
pub fn search_query(
    app: AppHandle,
    db: State<Database>,
    index: State<SearchIndex>,
    query: String,
    mode: Option<String>,
    scope_ids: Option<Vec<i64>>,
    type_filter: Option<String>,
    hide_missing: Option<bool>,
) -> Result<SearchQueryResult, String> {
    let params = SearchParams {
        query,
        mode: mode.unwrap_or_default(),
        scope: scope_ids,
        type_filter: type_filter.unwrap_or_default(),
        hide_missing: hide_missing.unwrap_or(false),
    };
    let ro = db.read_conn()?;
    let ids = index.search(ro.conn(), &params, &synonyms_loader(&app))?;
    Ok(SearchQueryResult { ids })
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

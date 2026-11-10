//! 主窗浏览视图的筛选与排序（迁移自前端 useItems 的非搜索分支，语义逐条对照）。
//!
//! 管线：视图域（全部 / 收藏 / 最近使用 / 文件柜）→ 标签筛选（正选 AND、反选排除，
//! 后代闭包由前端展开后传入）→ 目录层（关联柜按目录浏览 / 库内逐级浏览）或 All 隐藏夹内对象 →
//! 隐藏失效 → 类型筛选 → 排序（smart 可用冻结的最近使用时间）。
//! 搜索时不排序，改为把标签筛选后的范围交给搜索索引（见 `services::view_index`）。
//!
//! 名称排序与前端 `Intl.Collator("zh-CN", { numeric: true })` 一致（ICU4X 同一 CLDR 规则），
//! 为避免每次排序都做排序规则比较，索引重建时按显示名一次性排好、得到名次（比较为 0 的同名次）。

pub mod collation;
#[cfg(test)]
mod corpus_tests;

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::search::engine::type_matches;

/// 视图条目：只含筛选与排序需要的字段。
#[derive(Debug, Clone, Default)]
pub struct ViewEntry {
    pub id: i64,
    /// 显示名（别名优先）的排序名次
    pub name_rank: u32,
    pub item_type: String,
    pub is_favorite: bool,
    pub is_missing: bool,
    pub hide_from_all: bool,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub fs_created_at: Option<i64>,
    pub fs_modified_at: Option<i64>,
    /// `dirKey(parentDir(path))`
    pub parent_key: String,
    pub tag_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    All,
    Favorites,
    Recent,
    /// 文件柜：成员（任意顺序，结果按索引顺序）与关联文件夹
    Cabinet {
        members: Vec<i64>,
        linked_folder: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct ViewParams {
    pub scope: Scope,
    /// 每个正选标签的命中集合（直接标签模式 = 仅自身；后代模式 = 自身 ∪ 后代）
    pub selected_groups: Vec<Vec<i64>>,
    pub excluded_groups: Vec<Vec<i64>>,
    pub type_filter: String,
    pub hide_missing: bool,
    pub sort_mode: String,
    pub show_nested_contents: bool,
    pub library_browse_root: Option<String>,
    pub library_browse_dir: Option<String>,
    pub cabinet_dir: Option<String>,
    pub cabinet_flat: bool,
    pub has_search: bool,
}

impl Default for ViewParams {
    fn default() -> Self {
        Self {
            scope: Scope::All,
            selected_groups: Vec::new(),
            excluded_groups: Vec::new(),
            type_filter: "all".into(),
            hide_missing: false,
            sort_mode: "smart".into(),
            show_nested_contents: false,
            library_browse_root: None,
            library_browse_dir: None,
            cabinet_dir: None,
            cabinet_flat: false,
            has_search: false,
        }
    }
}

/// 冻结的最近使用时间：id → 快照值（None = 当时未用过）。
pub type FrozenKeys = HashMap<i64, Option<String>>;

#[derive(Debug, Clone, PartialEq)]
pub enum ViewPlan {
    /// 浏览：已排好的 ID
    Browse(Vec<i64>),
    /// 搜索：交给搜索索引的范围（None = 全部对象）
    Search(Option<Vec<i64>>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ViewOutput {
    pub plan: ViewPlan,
    /// 关联柜当前浏览目录（不按目录浏览时为 None）
    pub browse_dir: Option<String>,
}

// ------------------------------------------------------------------ 路径（与 cabinetBrowse.ts 一致）

/// `normalizeDir`：`/` → `\`，去掉末尾的 `\`
pub fn normalize_dir(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_string()
}

pub fn dir_key(path: &str) -> String {
    normalize_dir(path).to_lowercase()
}

pub fn parent_dir(path: &str) -> String {
    let n = normalize_dir(path);
    match n.rfind('\\') {
        Some(i) => n[..i].to_string(),
        None => String::new(),
    }
}

fn is_under_dir(path: &str, root: &str) -> bool {
    dir_key(path).starts_with(&format!("{}\\", dir_key(root)))
}

/// `currentBrowseDir`
pub fn current_browse_dir(root: &str, dir: Option<&str>) -> String {
    match dir {
        Some(d) if is_under_dir(d, root) => normalize_dir(d),
        _ => normalize_dir(root),
    }
}

pub fn parent_key_of(path: &str) -> String {
    dir_key(&parent_dir(path))
}

// ------------------------------------------------------------------ 排序（与 itemQuery.compareItems 一致）

fn type_order(t: &str) -> i32 {
    match t {
        "folder" => 0,
        "image" => 1,
        "audio" => 2,
        "video" => 3,
        "text" => 4,
        "exe" => 5,
        "bat" => 6,
        "ps1" => 7,
        _ => 9,
    }
}

fn file_time(a: Option<i64>, b: Option<i64>, newest_first: bool) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a), Some(b)) => {
            if newest_first {
                b.cmp(&a)
            } else {
                a.cmp(&b)
            }
        }
    }
}

/// JS 字符串比较（UTF-16 码元序）。时间戳是 ASCII，按字节比较等价。
fn ts(a: &Option<String>) -> &str {
    a.as_deref().unwrap_or("")
}

fn compare(a: &ViewEntry, b: &ViewEntry, mode: &str, frozen: Option<&FrozenKeys>) -> Ordering {
    let names = || a.name_rank.cmp(&b.name_rank);
    match mode {
        "name" => names(),
        "name-desc" => b.name_rank.cmp(&a.name_rank),
        "recent" => ts(&b.last_used_at)
            .cmp(ts(&a.last_used_at))
            .then_with(names),
        "added" => b.created_at.cmp(&a.created_at).then_with(names),
        "added-desc" => a.created_at.cmp(&b.created_at).then_with(names),
        "fs-created" | "fs-created-asc" => {
            file_time(a.fs_created_at, b.fs_created_at, mode == "fs-created").then_with(names)
        }
        "fs-modified" | "fs-modified-asc" => {
            file_time(a.fs_modified_at, b.fs_modified_at, mode == "fs-modified").then_with(names)
        }
        "type" => type_order(&a.item_type)
            .cmp(&type_order(&b.item_type))
            .then_with(names),
        _ => {
            if a.is_favorite != b.is_favorite {
                return if a.is_favorite {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
            let used = |e: &ViewEntry| -> String {
                match frozen.and_then(|f| f.get(&e.id)) {
                    Some(v) => v.clone().unwrap_or_default(),
                    None => e.last_used_at.clone().unwrap_or_default(),
                }
            };
            used(b).cmp(&used(a)).then_with(names)
        }
    }
}

// ------------------------------------------------------------------ 管线

fn tag_match(e: &ViewEntry, group: &[i64]) -> bool {
    e.tag_ids.iter().any(|t| group.contains(t))
}

/// 跑一次视图管线。`entries` 为索引顺序（与后端 get_items / get_cabinet_items 的 ITEM_ORDER 一致）。
pub fn run_view(
    entries: &[ViewEntry],
    params: &ViewParams,
    frozen: Option<&FrozenKeys>,
) -> ViewOutput {
    let members: Option<HashSet<i64>> = match &params.scope {
        Scope::Cabinet { members, .. } => Some(members.iter().copied().collect()),
        _ => None,
    };
    let has_tags = !params.selected_groups.is_empty() || !params.excluded_groups.is_empty();
    let source = entries.iter().filter(|e| match &params.scope {
        Scope::All => true,
        Scope::Favorites => e.is_favorite,
        Scope::Recent => e.last_used_at.as_deref().is_some_and(|s| !s.is_empty()),
        Scope::Cabinet { .. } => members.as_ref().is_some_and(|m| m.contains(&e.id)),
    });
    let tag_filtered: Vec<&ViewEntry> = source
        .filter(|e| {
            params.selected_groups.iter().all(|g| tag_match(e, g))
                && !params.excluded_groups.iter().any(|g| tag_match(e, g))
        })
        .collect();

    if params.has_search {
        // useItems：tagFiltered !== allItems 时才限定范围（视图域或标签筛选生效）
        let scoped = params.scope != Scope::All || has_tags;
        return ViewOutput {
            plan: ViewPlan::Search(scoped.then(|| tag_filtered.iter().map(|e| e.id).collect())),
            browse_dir: None,
        };
    }

    let browse_dir = match &params.scope {
        Scope::Cabinet {
            linked_folder: Some(root),
            ..
        } if !params.cabinet_flat && !has_tags => {
            Some(current_browse_dir(root, params.cabinet_dir.as_deref()))
        }
        _ => None,
    };
    let library_dir = match &params.library_browse_root {
        Some(root) if !has_tags => Some(current_browse_dir(
            root,
            params.library_browse_dir.as_deref(),
        )),
        _ => None,
    };
    let reveal_nested = params.show_nested_contents
        || has_tags
        || params.scope != Scope::All
        || params.library_browse_root.is_some();
    let layer_key = browse_dir
        .as_deref()
        .or(library_dir.as_deref())
        .map(dir_key);

    let mut out: Vec<&ViewEntry> = tag_filtered
        .into_iter()
        .filter(|e| match &layer_key {
            Some(k) => &e.parent_key == k,
            None => reveal_nested || !e.hide_from_all,
        })
        .filter(|e| !(params.hide_missing && e.is_missing))
        .filter(|e| type_matches(&e.item_type, &params.type_filter))
        .collect();
    let live = params.scope == Scope::Recent || params.sort_mode == "recent";
    let frozen = if live { None } else { frozen };
    out.sort_by(|a, b| compare(a, b, &params.sort_mode, frozen));
    ViewOutput {
        plan: ViewPlan::Browse(out.into_iter().map(|e| e.id).collect()),
        browse_dir,
    }
}

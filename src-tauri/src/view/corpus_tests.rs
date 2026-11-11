//! 与旧 TS 视图管线逐条对照（fixture 由 scripts/view-corpus/gen-view-corpus.ts 生成）。

use std::collections::HashMap;

use serde::Deserialize;

use super::collation::rank_names;
use super::*;
use crate::search::engine::js_trim;

#[derive(Deserialize)]
struct Item {
    id: i64,
    name: String,
    path: String,
    #[serde(rename = "type")]
    item_type: String,
    created_at: String,
    last_used_at: Option<String>,
    is_favorite: bool,
    is_missing: bool,
    fs_created_at: Option<i64>,
    fs_modified_at: Option<i64>,
    hide_from_all: bool,
    alias: Option<String>,
    #[serde(rename = "tagIds")]
    tag_ids: Vec<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseParams {
    scope: String,
    selected_tag_ids: Vec<i64>,
    excluded_tag_ids: Vec<i64>,
    tag_filter_mode: String,
    type_filter: String,
    hide_missing: bool,
    sort_mode: String,
    show_nested_contents: bool,
    library_browse_root: Option<String>,
    library_browse_dir: Option<String>,
    cabinet_dir: Option<String>,
    cabinet_flat: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    ids: Vec<i64>,
    browse_dir: Option<String>,
    search_scope: Option<Vec<i64>>,
}

#[derive(Deserialize)]
struct Case {
    params: CaseParams,
    cabinet: Option<String>,
    frozen: Option<usize>,
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    items: Vec<Item>,
    descendants: HashMap<String, Vec<i64>>,
    linked_folder: String,
    cabinets: HashMap<String, Vec<i64>>,
    frozen_sets: Vec<HashMap<String, Option<String>>>,
    cases: Vec<Case>,
}

fn display_name(it: &Item) -> &str {
    match it.alias.as_deref().map(js_trim) {
        Some(a) if !a.is_empty() => a,
        _ => &it.name,
    }
}

#[test]
fn view_matches_ts_pipeline() {
    let raw = include_str!("../../tests/fixtures/view_corpus.json");
    let corpus: Corpus = serde_json::from_str(raw).unwrap();
    let ranks = rank_names(corpus.items.iter().map(display_name));
    let entries: Vec<ViewEntry> = corpus
        .items
        .iter()
        .map(|it| ViewEntry {
            id: it.id,
            name_rank: ranks[display_name(it)],
            item_type: it.item_type.clone(),
            is_favorite: it.is_favorite,
            is_missing: it.is_missing,
            hide_from_all: it.hide_from_all,
            last_used_at: it.last_used_at.clone(),
            created_at: it.created_at.clone(),
            fs_created_at: it.fs_created_at,
            fs_modified_at: it.fs_modified_at,
            parent_key: parent_key_of(&it.path),
            tag_ids: it.tag_ids.clone(),
        })
        .collect();
    let frozen_sets: Vec<FrozenKeys> = corpus
        .frozen_sets
        .iter()
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.parse().unwrap(), v.clone()))
                .collect()
        })
        .collect();
    let group = |tid: i64, mode: &str| -> Vec<i64> {
        if mode == "direct" {
            vec![tid]
        } else {
            corpus
                .descendants
                .get(&tid.to_string())
                .cloned()
                .unwrap_or_else(|| vec![tid])
        }
    };
    let mut failures = Vec::new();
    for (i, c) in corpus.cases.iter().enumerate() {
        let p = &c.params;
        let scope = match p.scope.as_str() {
            "favorites" => Scope::Favorites,
            "recent" => Scope::Recent,
            "cabinet" | "linked" => Scope::Cabinet {
                members: corpus.cabinets[c.cabinet.as_deref().unwrap()].clone(),
                linked_folder: (p.scope == "linked").then(|| corpus.linked_folder.clone()),
            },
            _ => Scope::All,
        };
        let mut params = ViewParams {
            scope,
            selected_groups: p
                .selected_tag_ids
                .iter()
                .map(|&t| group(t, &p.tag_filter_mode))
                .collect(),
            excluded_groups: p
                .excluded_tag_ids
                .iter()
                .map(|&t| group(t, &p.tag_filter_mode))
                .collect(),
            type_filter: p.type_filter.clone(),
            hide_missing: p.hide_missing,
            sort_mode: p.sort_mode.clone(),
            show_nested_contents: p.show_nested_contents,
            library_browse_root: p.library_browse_root.clone(),
            library_browse_dir: p.library_browse_dir.clone(),
            cabinet_dir: p.cabinet_dir.clone(),
            cabinet_flat: p.cabinet_flat,
            has_search: false,
        };
        let frozen = c.frozen.map(|i| &frozen_sets[i]);
        let out = run_view(&entries, &params, frozen);
        if out.plan != ViewPlan::Browse(c.expected.ids.clone())
            || out.browse_dir != c.expected.browse_dir
        {
            failures.push(format!(
                "case {i} {:?}: got {:?} / {:?}, want {:?} / {:?}",
                p.scope, out.plan, out.browse_dir, c.expected.ids, c.expected.browse_dir
            ));
        }
        params.has_search = true;
        let out = run_view(&entries, &params, frozen);
        if out.plan != ViewPlan::Search(c.expected.search_scope.clone()) {
            failures.push(format!(
                "case {i} search scope: got {:?}, want {:?}",
                out.plan, c.expected.search_scope
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} / {} 条不一致：\n{}",
        failures.len(),
        corpus.cases.len() * 2,
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

//! 与迁移前 TS 实现逐条对照（语料由 scripts/search-corpus/gen-corpus.ts 生成）。

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;

use super::engine::{self, Entry, EntrySource, Mode, Synonyms, Text};
use super::pinyin;

#[derive(Deserialize)]
struct PinyinCorpus {
    cases: Vec<PinyinCase>,
}

#[derive(Deserialize)]
struct PinyinCase {
    text: String,
    full: String,
    initials: String,
}

#[derive(Deserialize)]
struct SearchCorpus {
    synonyms: Vec<Vec<String>>,
    items: Vec<CorpusItem>,
    cases: Vec<SearchCase>,
    #[serde(rename = "pipelineCases")]
    pipeline_cases: Vec<PipelineCase>,
}

#[derive(Deserialize)]
struct CorpusItem {
    id: i64,
    name: String,
    path: String,
    #[serde(rename = "type")]
    item_type: String,
    alias: Option<String>,
    note: Option<String>,
    is_favorite: bool,
    is_missing: bool,
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct SearchCase {
    q: String,
    mode: String,
    ids: Vec<i64>,
}

#[derive(Deserialize)]
struct PipelineCase {
    q: String,
    mode: String,
    #[serde(rename = "typeFilter")]
    type_filter: String,
    #[serde(rename = "hideMissing")]
    hide_missing: bool,
    ids: Vec<i64>,
}

#[test]
fn pinyin_matches_pinyin_pro() {
    let corpus: PinyinCorpus =
        serde_json::from_str(include_str!("../../tests/fixtures/pinyin_corpus.json")).unwrap();
    let mut failures = Vec::new();
    for c in &corpus.cases {
        let (full, initials) = pinyin::full_and_initials(&c.text);
        if full != c.full
            || initials != c.initials
            || pinyin::full(&c.text) != full
            || pinyin::initials(&c.text) != initials
        {
            failures.push(format!(
                "{:?}: full {:?} vs {:?}; initials {:?} vs {:?}",
                c.text, full, c.full, initials, c.initials
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} / {} 条不一致，前 20 条：\n{}",
        failures.len(),
        corpus.cases.len(),
        failures[..failures.len().min(20)].join("\n")
    );
}

fn build_entries(items: &[CorpusItem]) -> Vec<Entry> {
    let mut cache: HashMap<String, Text> = HashMap::new();
    let mut tag_cache: HashMap<String, Arc<Text>> = HashMap::new();
    items
        .iter()
        .map(|it| {
            let tags = it
                .tags
                .iter()
                .map(|t| {
                    tag_cache
                        .entry(t.clone())
                        .or_insert_with(|| Arc::new(engine::build_text(t)))
                        .clone()
                })
                .collect();
            let src = EntrySource {
                id: it.id,
                name: &it.name,
                path: &it.path,
                alias: it.alias.as_deref(),
                note: it.note.as_deref(),
                is_favorite: it.is_favorite,
                is_missing: it.is_missing,
                item_type: &it.item_type,
            };
            Entry::build(&src, tags, &mut |s| {
                cache
                    .entry(s.to_string())
                    .or_insert_with(|| engine::build_text(s))
                    .clone()
            })
        })
        .collect()
}

#[test]
fn search_matches_ts_implementation() {
    let corpus: SearchCorpus =
        serde_json::from_str(include_str!("../../tests/fixtures/search_corpus.json")).unwrap();
    let syn = Synonyms::from_groups(&corpus.synonyms);
    let entries = build_entries(&corpus.items);
    let mut failures = Vec::new();
    for c in &corpus.cases {
        let q = engine::compile(&c.q, Mode::parse(&c.mode), &syn);
        let got: Vec<i64> = engine::run(&q, &entries)
            .into_iter()
            .map(|e| e.id)
            .collect();
        if got != c.ids {
            failures.push(format!(
                "[{}] {:?}: got {:?}\n    want {:?}",
                c.mode, c.q, got, c.ids
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} / {} 条不一致，前 20 条：\n{}",
        failures.len(),
        corpus.cases.len(),
        failures[..failures.len().min(20)].join("\n")
    );

    let mut failures = Vec::new();
    for c in &corpus.pipeline_cases {
        let q = engine::compile(&c.q, Mode::parse(&c.mode), &syn);
        let got: Vec<i64> = engine::run(&q, &entries)
            .into_iter()
            .filter(|e| {
                engine::type_matches(&e.item_type, &c.type_filter)
                    && !(c.hide_missing && e.is_missing)
            })
            .map(|e| e.id)
            .collect();
        if got != c.ids {
            failures.push(format!(
                "[{} {} {}] {:?}",
                c.mode, c.type_filter, c.hide_missing, c.q
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "管线 {} 条不一致：{}",
        failures.len(),
        failures.join("; ")
    );
}

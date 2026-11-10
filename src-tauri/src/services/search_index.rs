//! 内存搜索索引（主窗与快速搜索窗共用）。
//!
//! - 条目按 `get_items` 的默认排序（收藏 → 最近使用 → 名称）保存，与对象表一一对应；
//! - 新鲜度：每次查询前比对只读连接的 `PRAGMA data_version`（任何连接提交后都会变：
//!   本应用写入、tl CLI 等外部写入都覆盖），变了就重建；data_sync 检测到变化时也会在
//!   后台先重建（[`SearchIndex::refresh_if_built`]），让下一次按键不承担重建耗时；
//! - 重建是「重读行 + 复用派生字段」：名称/别名/标签名的拼音等字段按原文缓存，
//!   只有新出现或改过的文本才重新分词，所以改一个对象只为那一个对象付拼音代价；
//! - 同义词首次建索引时读取一次（与旧前端一样随应用启动生效）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rusqlite::Connection;
use serde::Serialize;

use crate::search::engine::{self, Entry, EntrySource, Mode, Synonyms, Text};
use crate::services::item_service::ITEM_ORDER;

/// 一次查询的参数（前端两个窗口共用）。
#[derive(Debug, Clone, Default)]
pub struct SearchParams {
    pub query: String,
    pub mode: String,
    /// 限定范围（主窗的文件柜/收藏/最近/标签筛选结果），按给定顺序作为结果的基础顺序；
    /// None = 全部对象（索引顺序）
    pub scope: Option<Vec<i64>>,
    pub type_filter: String,
    pub hide_missing: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub entries: usize,
    pub builds: u64,
    pub last_build_ms: f64,
    /// 最近一次重建里重新分词的文本数（其余复用缓存）
    pub last_build_new_texts: usize,
    pub cached_texts: usize,
    /// 索引派生字段的估算字节数（字符串与数组的堆容量之和，不含 HashMap 自身开销）
    pub approx_bytes: usize,
}

#[derive(Default)]
struct Inner {
    version: Option<i64>,
    entries: Vec<Entry>,
    pos: HashMap<i64, usize>,
    texts: HashMap<String, Arc<Text>>,
    synonyms: Option<Synonyms>,
    stats: IndexStats,
}

#[derive(Default)]
pub struct SearchIndex {
    inner: Mutex<Inner>,
}

fn data_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA data_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

struct Row {
    id: i64,
    name: String,
    path: String,
    item_type: String,
    alias: Option<String>,
    note: Option<String>,
    is_favorite: bool,
    is_missing: bool,
}

fn read_rows(conn: &Connection) -> Result<(Vec<Row>, HashMap<i64, Vec<String>>), String> {
    let sql = format!(
        "SELECT id, name, path, type, alias, note, is_favorite, is_missing FROM items ORDER BY {ITEM_ORDER}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                item_type: r.get(3)?,
                alias: r.get(4)?,
                note: r.get(5)?,
                is_favorite: r.get::<_, i64>(6)? != 0,
                is_missing: r.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    let mut stmt = conn
        .prepare("SELECT it.item_id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id")
        .map_err(|e| e.to_string())?;
    let mut tags: HashMap<i64, Vec<String>> = HashMap::new();
    for pair in stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
    {
        tags.entry(pair.0).or_default().push(pair.1);
    }
    Ok((rows, tags))
}

fn text_bytes(t: &Text) -> usize {
    t.heap_bytes() + std::mem::size_of::<Text>()
}

impl Inner {
    fn rebuild(&mut self, conn: &Connection, version: i64) -> Result<(), String> {
        let started = Instant::now();
        // 同一读事务里取对象与标签，避免两次查询之间有提交导致对不上
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let (rows, tags) = read_rows(&tx)?;
        drop(tx);
        let mut old = std::mem::take(&mut self.texts);
        let mut texts: HashMap<String, Arc<Text>> =
            HashMap::with_capacity(old.len().max(rows.len()));
        let mut new_texts = 0usize;
        let mut text_of = |s: &str| -> Arc<Text> {
            if let Some(t) = texts.get(s) {
                return Arc::clone(t);
            }
            let t = old.remove(s).unwrap_or_else(|| {
                new_texts += 1;
                Arc::new(engine::build_text(s))
            });
            texts.insert(s.to_string(), Arc::clone(&t));
            t
        };
        let mut entries = Vec::with_capacity(rows.len());
        for row in &rows {
            let tag_texts = tags
                .get(&row.id)
                .map(|names| names.iter().map(|n| text_of(n)).collect())
                .unwrap_or_default();
            let src = EntrySource {
                id: row.id,
                name: &row.name,
                path: &row.path,
                alias: row.alias.as_deref(),
                note: row.note.as_deref(),
                is_favorite: row.is_favorite,
                is_missing: row.is_missing,
                item_type: &row.item_type,
            };
            entries.push(Entry::build(&src, tag_texts, &mut text_of));
        }
        self.pos = entries.iter().enumerate().map(|(i, e)| (e.id, i)).collect();
        self.entries = entries;
        self.texts = texts;
        self.version = Some(version);
        let approx = self
            .texts
            .iter()
            .map(|(k, t)| k.capacity() + text_bytes(t))
            .sum::<usize>()
            + self
                .entries
                .iter()
                .map(|e| e.heap_bytes() + std::mem::size_of::<Entry>())
                .sum::<usize>();
        self.stats = IndexStats {
            entries: self.entries.len(),
            builds: self.stats.builds + 1,
            last_build_ms: started.elapsed().as_secs_f64() * 1000.0,
            last_build_new_texts: new_texts,
            cached_texts: self.texts.len(),
            approx_bytes: approx,
        };
        Ok(())
    }

    fn ensure_fresh(
        &mut self,
        conn: &Connection,
        load_synonyms: &dyn Fn() -> Vec<Vec<String>>,
    ) -> Result<(), String> {
        if self.synonyms.is_none() {
            self.synonyms = Some(Synonyms::from_groups(&load_synonyms()));
        }
        let v = data_version(conn)?;
        if self.version != Some(v) {
            self.rebuild(conn, v)?;
        }
        Ok(())
    }
}

impl SearchIndex {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// 确保索引已建且是最新（首次调用即建）。
    pub fn warm(
        &self,
        conn: &Connection,
        load_synonyms: &dyn Fn() -> Vec<Vec<String>>,
    ) -> Result<(), String> {
        self.lock().ensure_fresh(conn, load_synonyms)
    }

    /// 已建过索引时按需重建（data_sync 检测到写入后调用）；从没建过则什么都不做。
    pub fn refresh_if_built(&self, conn: &Connection) -> Result<(), String> {
        let mut inner = self.lock();
        if inner.version.is_none() {
            return Ok(());
        }
        let v = data_version(conn)?;
        if inner.version != Some(v) {
            inner.rebuild(conn, v)?;
        }
        Ok(())
    }

    /// 按查询返回全部命中 ID（已排序、已应用类型与丢失筛选）。
    pub fn search(
        &self,
        conn: &Connection,
        params: &SearchParams,
        load_synonyms: &dyn Fn() -> Vec<Vec<String>>,
    ) -> Result<Vec<i64>, String> {
        let mut inner = self.lock();
        inner.ensure_fresh(conn, load_synonyms)?;
        let inner = &*inner;
        let syn = inner.synonyms.as_ref().expect("ensure_fresh 已加载同义词");
        let query = engine::compile(&params.query, Mode::parse(&params.mode), syn);
        let hits = match &params.scope {
            None => engine::run(&query, &inner.entries),
            Some(ids) => engine::run(
                &query,
                ids.iter()
                    .filter_map(|id| inner.pos.get(id).map(|&i| &inner.entries[i])),
            ),
        };
        Ok(hits
            .into_iter()
            .filter(|e| {
                engine::type_matches(&e.item_type, &params.type_filter)
                    && !(params.hide_missing && e.is_missing)
            })
            .map(|e| e.id)
            .collect())
    }

    pub fn stats(&self) -> IndexStats {
        self.lock().stats.clone()
    }
}

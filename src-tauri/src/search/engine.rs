//! 搜索打分与排序（主窗与快速搜索窗共用的唯一实现）。
//!
//! 语义逐条复刻迁移前的前端 `src/lib/search.ts`（对照语料 tests/fixtures/search_corpus.json）：
//! - 表达式：`&&` 与、`||` 或、`!!` 排除（左结合，可一元）、括号、空白=隐式或、`@词` 严格全名；
//! - 每个词项先按同义词等价类展开；名称/别名/标签各有「小写原文、全拼、首字母、英文分词」四个字段；
//! - 强命中（2）：前缀（原文/全拼/首字母）、CJK 子串、英文低容错（编辑距离 ≤1）、路径前缀；
//!   弱命中（1）：英文首字母缩写 / 连写子序列、备注子串（仅「全部」范围）；
//! - 排序：收藏强 → 收藏弱 → 其余强 → 其余弱，桶内保持索引顺序。
//!
//! 字符串规则按 JS 口径实现（`\s` 空白集合、`trim`、UTF-16 下标），保证与旧实现同结果。

use std::collections::HashMap;
use std::sync::Arc;

use super::pinyin;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    All,
    Name,
    Tag,
}

impl Mode {
    pub fn parse(s: &str) -> Self {
        match s {
            "name" => Mode::Name,
            "tag" => Mode::Tag,
            _ => Mode::All,
        }
    }
}

// ------------------------------------------------------------------ JS 字符串口径

/// JS 正则 `\s` 与 `String.prototype.trim` 的空白集合。
pub fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(js_space)
}

/// 旧实现的 normalize：trim + toLowerCase。
pub fn normalize(s: &str) -> String {
    js_trim(s).to_lowercase()
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30FF}' | '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}')
}

fn is_typo_byte(b: u8) -> bool {
    b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'.' | b'-')
}

// ------------------------------------------------------------------ 字段

#[derive(Debug, Default, Clone)]
pub struct EnglishFields {
    initials: String,
    /// 连写串（UTF-16 码元，与旧实现的下标口径一致）
    compact: Vec<u16>,
    word_starts: Vec<usize>,
}

#[derive(Debug, Default, Clone)]
pub struct Text {
    name: String,
    pinyin_name: String,
    pinyin_initials: String,
    english: EnglishFields,
}

fn derive_english(name: &str) -> EnglishFields {
    if !name.bytes().any(|b| b.is_ascii_alphabetic()) {
        return EnglishFields::default();
    }
    // split(/[\s_-]+|(?<=[a-z])(?=[A-Z])/)
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for c in name.chars() {
        if js_space(c) || c == '_' || c == '-' {
            if !matches!(prev, Some(p) if js_space(p) || p == '_' || p == '-') {
                words.push(std::mem::take(&mut cur));
            }
        } else {
            if c.is_ascii_uppercase() && matches!(prev, Some(p) if p.is_ascii_lowercase()) {
                words.push(std::mem::take(&mut cur));
            }
            cur.push(c);
        }
        prev = Some(c);
    }
    words.push(cur);
    let mut out = EnglishFields::default();
    for word in words.iter().filter(|w| {
        w.as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_alphabetic())
    }) {
        out.initials
            .push(word.as_bytes()[0].to_ascii_lowercase() as char);
        out.word_starts.push(out.compact.len());
        out.compact.extend(word.to_lowercase().encode_utf16());
    }
    out
}

/// 一段文本（名称/别名/标签名）的全部搜索字段。
pub fn build_text(raw: &str) -> Text {
    let (full, initials) = pinyin::full_and_initials(raw);
    Text {
        name: normalize(raw),
        pinyin_name: normalize(&full),
        pinyin_initials: normalize(&initials),
        english: derive_english(raw),
    }
}

/// 索引条目：一个对象的搜索字段。标签字段按标签名共享（`Arc`）。
#[derive(Debug, Clone)]
pub struct Entry {
    pub id: i64,
    pub is_favorite: bool,
    pub is_missing: bool,
    pub item_type: String,
    name: Text,
    alias: Option<Text>,
    path_without_drive: String,
    tags: Vec<Arc<Text>>,
    note: String,
}

/// 构建条目所需的原始字段。
pub struct EntrySource<'a> {
    pub id: i64,
    pub name: &'a str,
    pub path: &'a str,
    pub alias: Option<&'a str>,
    pub note: Option<&'a str>,
    pub is_favorite: bool,
    pub is_missing: bool,
    pub item_type: &'a str,
}

/// 去盘符：`/^[a-z]:[\\/]+/i`
fn strip_drive(path: &str) -> &str {
    let b = path.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
    {
        let rest = &path[2..];
        rest.trim_start_matches(['\\', '/'])
    } else {
        path
    }
}

impl Entry {
    /// `text_of`：按原文取（可缓存的）字段，名称/别名/标签共用同一缓存。
    pub fn build(
        src: &EntrySource<'_>,
        tags: Vec<Arc<Text>>,
        text_of: &mut dyn FnMut(&str) -> Text,
    ) -> Entry {
        let alias = src.alias.map(js_trim).filter(|a| !a.is_empty());
        Entry {
            id: src.id,
            is_favorite: src.is_favorite,
            is_missing: src.is_missing,
            item_type: src.item_type.to_string(),
            name: text_of(src.name),
            alias: alias.map(|a| text_of(a)),
            path_without_drive: normalize(strip_drive(src.path)),
            tags,
            note: normalize(src.note.unwrap_or("")),
        }
    }
}

// ------------------------------------------------------------------ 同义词

/// 同义词等价类（与旧 buildSynonymMap 相同：共享词的组合并、成员保持首次出现顺序）。
#[derive(Debug, Default, Clone)]
pub struct Synonyms {
    map: HashMap<String, Arc<Vec<String>>>,
}

impl Synonyms {
    pub fn from_groups(groups: &[Vec<String>]) -> Self {
        let mut merged: Vec<Vec<String>> = Vec::new();
        let mut word_to_group: HashMap<String, usize> = HashMap::new();
        for group in groups {
            let normalized: Vec<String> = group
                .iter()
                .map(|w| w.trim_matches(js_space).to_lowercase())
                .filter(|w| !w.is_empty())
                .collect();
            if normalized.is_empty() {
                continue;
            }
            let mut hits: Vec<usize> = Vec::new();
            for word in &normalized {
                if let Some(&idx) = word_to_group.get(word) {
                    if !hits.contains(&idx) {
                        hits.push(idx);
                    }
                }
            }
            if hits.is_empty() {
                let mut unique: Vec<String> = Vec::new();
                for w in normalized {
                    if !unique.contains(&w) {
                        unique.push(w);
                    }
                }
                let idx = merged.len();
                for w in &unique {
                    word_to_group.insert(w.clone(), idx);
                }
                merged.push(unique);
                continue;
            }
            let target = hits[0];
            let mut members = std::mem::take(&mut merged[target]);
            let append = |w: &String, members: &mut Vec<String>| {
                if !members.contains(w) {
                    members.push(w.clone());
                }
            };
            for w in &normalized {
                append(w, &mut members);
            }
            for &idx in &hits[1..] {
                let moved = std::mem::take(&mut merged[idx]);
                for w in &moved {
                    append(w, &mut members);
                }
            }
            for w in &members {
                word_to_group.insert(w.clone(), target);
            }
            merged[target] = members;
        }
        let mut map = HashMap::new();
        for group in merged.into_iter().filter(|g| !g.is_empty()) {
            let group = Arc::new(group);
            for w in group.iter() {
                map.insert(w.clone(), Arc::clone(&group));
            }
        }
        Synonyms { map }
    }

    /// 旧 expandQuery：原词在前，其后为同组其它词。
    fn expand(&self, query: &str) -> Vec<String> {
        let key = normalize(query);
        if key.is_empty() {
            return vec![query.to_string()];
        }
        match self.map.get(&key) {
            None => vec![query.to_string()],
            Some(group) => {
                let mut out = vec![query.to_string()];
                out.extend(group.iter().filter(|w| **w != key).cloned());
                out
            }
        }
    }
}

// ------------------------------------------------------------------ 查询解析

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Term { value: String, strict: bool },
    And,
    Or,
    Not,
    LParen,
    RParen,
}

#[derive(Debug, Clone)]
enum Expr {
    Term { value: String, strict: bool },
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Exclude(Box<Expr>, Box<Expr>),
}

fn push_term(tokens: &mut Vec<Token>, raw: &str) {
    let value = js_trim(raw);
    if value.is_empty() {
        return;
    }
    if let Some(rest) = value.strip_prefix('@') {
        let strict = js_trim(rest);
        if !strict.is_empty() {
            tokens.push(Token::Term {
                value: strict.to_string(),
                strict: true,
            });
        }
        return;
    }
    tokens.push(Token::Term {
        value: value.to_string(),
        strict: false,
    });
}

fn tokenize(query: &str) -> Vec<Token> {
    let chars: Vec<char> = query.chars().collect();
    let starts =
        |i: usize, a: char, b: char| chars.get(i) == Some(&a) && chars.get(i + 1) == Some(&b);
    let mut tokens = Vec::new();
    let mut buffer = String::new();
    let mut i = 0;
    while i < chars.len() {
        let op = if starts(i, '&', '&') {
            Some(Token::And)
        } else if starts(i, '|', '|') {
            Some(Token::Or)
        } else if starts(i, '!', '!') {
            Some(Token::Not)
        } else {
            None
        };
        if let Some(op) = op {
            push_term(&mut tokens, &buffer);
            buffer.clear();
            tokens.push(op);
            i += 2;
            continue;
        }
        let c = chars[i];
        if c == '(' || c == ')' {
            push_term(&mut tokens, &buffer);
            buffer.clear();
            tokens.push(if c == '(' {
                Token::LParen
            } else {
                Token::RParen
            });
            i += 1;
            continue;
        }
        if js_space(c) {
            push_term(&mut tokens, &buffer);
            buffer.clear();
            let mut next = i;
            while next + 1 < chars.len() && js_space(chars[next + 1]) {
                next += 1;
            }
            let up = next + 1;
            let explicit = starts(up, '&', '&')
                || starts(up, '|', '|')
                || starts(up, '!', '!')
                || chars.get(up) == Some(&')');
            if !explicit && tokens.last().is_some_and(|t| *t != Token::Or) {
                tokens.push(Token::Or);
            }
            i += 1;
            continue;
        }
        buffer.push(c);
        i += 1;
    }
    push_term(&mut tokens, &buffer);
    let kept: Vec<bool> = (0..tokens.len())
        .map(|idx| {
            if tokens[idx] != Token::Or {
                return true;
            }
            let prev = idx.checked_sub(1).map(|p| &tokens[p]);
            let next = tokens.get(idx + 1);
            matches!(prev, Some(Token::Term { .. }) | Some(Token::RParen))
                && matches!(
                    next,
                    Some(Token::Term { .. }) | Some(Token::LParen) | Some(Token::Not)
                )
        })
        .collect();
    tokens
        .into_iter()
        .zip(kept)
        .filter(|(_, k)| *k)
        .map(|(t, _)| t)
        .collect()
}

struct Parser {
    tokens: Vec<Token>,
    index: usize,
}

fn empty_term() -> Box<Expr> {
    Box::new(Expr::Term {
        value: String::new(),
        strict: false,
    })
}

impl Parser {
    fn current(&self) -> Option<&Token> {
        self.tokens.get(self.index)
    }

    fn consume(&mut self, t: &Token) -> bool {
        if self.current() == Some(t) {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn parse_exclude(&mut self) -> Option<Expr> {
        if self.consume(&Token::Not) {
            let right = self.parse_exclude()?;
            return Some(Expr::Exclude(empty_term(), Box::new(right)));
        }
        let mut expr = self.parse_or();
        while self.consume(&Token::Not) {
            let right = self.parse_or();
            match (expr, right) {
                (Some(l), Some(r)) => expr = Some(Expr::Exclude(Box::new(l), Box::new(r))),
                (l, _) => return l,
            }
        }
        expr
    }

    fn parse_or(&mut self) -> Option<Expr> {
        let mut expr = self.parse_and();
        while self.consume(&Token::Or) {
            let right = self.parse_and();
            match (expr, right) {
                (Some(l), Some(r)) => expr = Some(Expr::Or(Box::new(l), Box::new(r))),
                (l, r) => return l.or(r),
            }
        }
        expr
    }

    fn parse_and(&mut self) -> Option<Expr> {
        let mut expr = self.parse_primary();
        while self.consume(&Token::And) {
            let right = self.parse_primary();
            match (expr, right) {
                (Some(l), Some(r)) => expr = Some(Expr::And(Box::new(l), Box::new(r))),
                (l, r) => return l.or(r),
            }
        }
        expr
    }

    fn parse_primary(&mut self) -> Option<Expr> {
        match self.current()?.clone() {
            Token::Not => {
                self.index += 1;
                let right = self.parse_primary()?;
                Some(Expr::Exclude(empty_term(), Box::new(right)))
            }
            Token::Term { value, strict } => {
                self.index += 1;
                Some(Expr::Term { value, strict })
            }
            Token::LParen => {
                self.index += 1;
                let expr = self.parse_exclude();
                self.consume(&Token::RParen);
                expr
            }
            _ => None,
        }
    }
}

// ------------------------------------------------------------------ 匹配

fn prefix_slice_edit_distance(prefix: &[u8], query: &[u8]) -> Option<u8> {
    if !prefix.iter().all(|&b| is_typo_byte(b)) {
        return None;
    }
    if prefix.len().abs_diff(query.len()) > 1 {
        return None;
    }
    if query.len() < 5 && prefix.first() != query.first() {
        return None;
    }
    let (mut si, mut qi, mut edits) = (0usize, 0usize, 0u8);
    while si < prefix.len() && qi < query.len() {
        if prefix[si] == query[qi] {
            si += 1;
            qi += 1;
            continue;
        }
        edits += 1;
        if edits > 1 {
            return Some(2);
        }
        if prefix.len() >= query.len() {
            si += 1;
        }
        if query.len() >= prefix.len() {
            qi += 1;
        }
    }
    Some(edits + u8::from(si < prefix.len() || qi < query.len()))
}

/// 见模块说明：查询为 ASCII，源串前缀须全为 `[a-z0-9_.-]`，因此按字节切片与 UTF-16 切片等价。
fn english_prefix_edit_distance(source: &[u8], query: &[u8]) -> Option<u8> {
    let mut best: Option<u8> = None;
    let q = query.len();
    for len in [q, q.wrapping_sub(1), q + 1] {
        if len < 1 || len == usize::MAX || len > source.len() {
            continue;
        }
        if let Some(d) = prefix_slice_edit_distance(&source[..len], query) {
            if best.is_none_or(|b| d < b) {
                best = Some(d);
            }
        }
        if best == Some(0) {
            break;
        }
    }
    best
}

fn is_english_typo_match(source: &str, query: &str) -> bool {
    let q = query.as_bytes();
    if q.len() < 3 || !q.iter().all(|&b| is_typo_byte(b)) {
        return false;
    }
    let s = source.as_bytes();
    if english_prefix_edit_distance(s, q).is_some_and(|d| d <= 1) {
        return true;
    }
    // source.match(/[a-z][a-z0-9_.-]*/g) 的每个词：编辑距离恰好为 1
    let mut i = 0;
    while i < s.len() {
        if s[i].is_ascii_lowercase() {
            let start = i;
            i += 1;
            while i < s.len() && is_typo_byte(s[i]) {
                i += 1;
            }
            if english_prefix_edit_distance(&s[start..i], q) == Some(1) {
                return true;
            }
        } else {
            i += 1;
        }
    }
    false
}

fn prefix_matches(value: &str, query: &str) -> bool {
    if query.is_empty() || value.starts_with(query) {
        return true;
    }
    if query.chars().any(is_cjk) && value.contains(query) {
        return true;
    }
    is_english_typo_match(value, query)
}

fn is_abbr_query(q: &str) -> bool {
    q.len() >= 2 && q.bytes().all(|b| b.is_ascii_lowercase())
}

fn is_compact_subsequence(f: &EnglishFields, query: &str) -> bool {
    let mut prev: isize = -1;
    for ch in query.bytes() {
        let ch = u16::from(ch);
        let mut hit: isize = -1;
        let mut i = (prev + 1) as usize;
        while i < f.compact.len() {
            if f.compact[i] == ch && (i as isize == prev + 1 || f.word_starts.contains(&i)) {
                hit = i as isize;
                break;
            }
            i += 1;
        }
        if hit == -1 {
            return false;
        }
        prev = hit;
    }
    true
}

fn score_english_abbrev(f: &EnglishFields, query: &str) -> u8 {
    if f.compact.is_empty() || !is_abbr_query(query) {
        return 0;
    }
    if f.initials.starts_with(query) || is_compact_subsequence(f, query) {
        1
    } else {
        0
    }
}

fn score_text(t: &Text, query: &str, strict: bool) -> u8 {
    if strict {
        return if t.name == query { 2 } else { 0 };
    }
    if prefix_matches(&t.name, query)
        || prefix_matches(&t.pinyin_name, query)
        || prefix_matches(&t.pinyin_initials, query)
    {
        return 2;
    }
    score_english_abbrev(&t.english, query)
}

fn score_name(e: &Entry, query: &str, strict: bool) -> u8 {
    let mut score = score_text(&e.name, query, strict);
    if score != 2 {
        if let Some(alias) = &e.alias {
            score = score.max(score_text(alias, query, strict));
        }
    }
    if strict || score == 2 {
        return score;
    }
    if prefix_matches(&e.path_without_drive, query) {
        2
    } else {
        score
    }
}

fn score_tag(e: &Entry, query: &str, strict: bool) -> u8 {
    let mut best = 0;
    for t in &e.tags {
        let s = score_text(t, query, strict);
        if s == 2 {
            return 2;
        }
        best = best.max(s);
    }
    best
}

// ------------------------------------------------------------------ 编译与执行

pub enum Scorer {
    Term { queries: Vec<String>, strict: bool },
    And(Box<Scorer>, Box<Scorer>),
    Or(Box<Scorer>, Box<Scorer>),
    Exclude(Box<Scorer>, Box<Scorer>),
}

fn compile_expr(expr: Expr, syn: &Synonyms) -> Scorer {
    match expr {
        Expr::Term { value, strict } => {
            let raw = if strict {
                vec![value]
            } else {
                syn.expand(&value)
            };
            Scorer::Term {
                queries: raw.iter().map(|q| normalize(q)).collect(),
                strict,
            }
        }
        Expr::And(l, r) => Scorer::And(
            Box::new(compile_expr(*l, syn)),
            Box::new(compile_expr(*r, syn)),
        ),
        Expr::Or(l, r) => Scorer::Or(
            Box::new(compile_expr(*l, syn)),
            Box::new(compile_expr(*r, syn)),
        ),
        Expr::Exclude(l, r) => Scorer::Exclude(
            Box::new(compile_expr(*l, syn)),
            Box::new(compile_expr(*r, syn)),
        ),
    }
}

impl Scorer {
    fn score(&self, e: &Entry, mode: Mode) -> u8 {
        match self {
            Scorer::Term { queries, strict } => {
                let strict = *strict;
                let mut best = 0;
                for term in queries {
                    if term.is_empty() {
                        return 2;
                    }
                    let mut s = if mode == Mode::Tag {
                        score_tag(e, term, strict)
                    } else {
                        score_name(e, term, strict)
                    };
                    if mode == Mode::All && s != 2 {
                        s = s.max(score_tag(e, term, strict));
                    }
                    if mode == Mode::All && s == 0 && !strict && e.note.contains(term.as_str()) {
                        s = 1;
                    }
                    if s == 2 {
                        return 2;
                    }
                    best = best.max(s);
                }
                best
            }
            Scorer::And(l, r) => {
                let left = l.score(e, mode);
                if left == 0 {
                    0
                } else {
                    left.min(r.score(e, mode))
                }
            }
            Scorer::Or(l, r) => {
                let left = l.score(e, mode);
                if left == 2 {
                    2
                } else {
                    left.max(r.score(e, mode))
                }
            }
            Scorer::Exclude(l, r) => {
                let left = l.score(e, mode);
                if left > 0 && r.score(e, mode) == 0 {
                    left
                } else {
                    0
                }
            }
        }
    }
}

/// 编译后的查询：空查询/无法解析 = 全部（原顺序）；单独一个 `@` = 无结果。
pub enum Query {
    All,
    Nothing,
    Expr(Scorer, Mode),
}

pub fn compile(query: &str, mode: Mode, syn: &Synonyms) -> Query {
    let q = js_trim(query);
    if q.is_empty() {
        return Query::All;
    }
    if q == "@" {
        return Query::Nothing;
    }
    let tokens = tokenize(q);
    if tokens.is_empty() {
        return Query::All;
    }
    match (Parser { tokens, index: 0 }).parse_exclude() {
        None => Query::All,
        Some(expr) => Query::Expr(compile_expr(expr, syn), mode),
    }
}

/// 按排序契约返回命中条目（收藏强、收藏弱、其余强、其余弱；桶内保持输入顺序）。
pub fn run<'a, I>(query: &Query, entries: I) -> Vec<&'a Entry>
where
    I: IntoIterator<Item = &'a Entry>,
{
    match query {
        Query::All => entries.into_iter().collect(),
        Query::Nothing => Vec::new(),
        Query::Expr(scorer, mode) => {
            let mut buckets: [Vec<&'a Entry>; 4] = Default::default();
            for e in entries {
                let s = scorer.score(e, *mode);
                if s == 0 {
                    continue;
                }
                let b = match (e.is_favorite, s == 2) {
                    (true, true) => 0,
                    (true, false) => 1,
                    (false, true) => 2,
                    (false, false) => 3,
                };
                buckets[b].push(e);
            }
            let [a, b, c, d] = buckets;
            let mut out = a;
            out.extend(b);
            out.extend(c);
            out.extend(d);
            out
        }
    }
}

/// 类型筛选（与 itemQuery.itemMatchesType 一致）。
pub fn type_matches(item_type: &str, filter: &str) -> bool {
    match filter {
        "" | "all" => true,
        "script" => item_type == "bat" || item_type == "ps1",
        f => item_type == f,
    }
}

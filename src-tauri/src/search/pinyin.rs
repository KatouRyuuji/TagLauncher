//! 汉字转拼音（搜索专用）：复刻 pinyin-pro 3.29.5 在搜索里用到的两种调用，
//! 结果须与旧前端实现逐字一致（对照语料 tests/fixtures/pinyin_corpus.json）：
//! - `full`：`pinyin(v, { toneType: "none", type: "array" }).join("")`
//! - `initials`：`pinyin(v, { pattern: "first", toneType: "none", type: "array" }).join("")`
//!
//! 算法同 pinyin-pro（MIT, Copyright (c) zh-lx）：多字词按最大概率分词
//! （Aho-Corasick 命中 + 自后向前 DP，姓氏词典关闭），未落在多字词里的字逐字取第一读音，
//! 「了」在句首/非汉字后读 liao、「々」重复前字读音。词典数据见 pinyin_data.txt
//! （scripts/search-corpus/export-pinyin-data.mjs 导出，已去声调）。

use std::collections::HashMap;
use std::sync::OnceLock;

const DATA: &str = include_str!("pinyin_data.txt");
/// pinyin-pro Probability.Unknown：未成词的单字
const PROB_UNKNOWN: f64 = 1e-13;

struct Word {
    /// 逐字读音（已去调），与词的字数相同
    syllables: Vec<&'static str>,
    probability: f64,
}

struct Dict {
    chars: HashMap<char, &'static str>,
    words: HashMap<&'static str, Word>,
    max_word_chars: usize,
}

fn dict() -> &'static Dict {
    static DICT: OnceLock<Dict> = OnceLock::new();
    DICT.get_or_init(|| {
        let mut chars = HashMap::with_capacity(22_000);
        let mut words = HashMap::with_capacity(4_500);
        let mut max_word_chars = 0;
        let mut section = "";
        for line in DATA.lines() {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') {
                section = line;
                continue;
            }
            let mut cols = line.split('\t');
            let key = cols.next().unwrap_or_default();
            let value = cols.next().unwrap_or_default();
            if section == "[chars]" {
                if let Some(c) = key.chars().next() {
                    chars.insert(c, value);
                }
            } else {
                let probability = cols
                    .next()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(PROB_UNKNOWN);
                max_word_chars = max_word_chars.max(key.chars().count());
                words.insert(
                    key,
                    Word {
                        syllables: value.split(' ').collect(),
                        probability,
                    },
                );
            }
        }
        Dict {
            chars,
            words,
            max_word_chars,
        }
    })
}

/// 预热词典（启动后台调用，避免首个搜索承担解析耗时）。
pub fn warm_up() {
    dict();
}

/// 每个字的读音（未识别为汉字的保留原字符，`is_zh=false`）。
struct Syllable {
    text: String,
    is_zh: bool,
}

#[derive(Clone, Copy)]
struct Dp {
    probability: f64,
    decimal: i32,
    /// 以此处开始的多字词：(起点, 字数)
    word: Option<(usize, usize)>,
    next: usize,
}

/// pinyin-pro getMaxProbability：decimal 小者胜；相等时概率严格更大者胜，否则取后来者。
fn better(a: Option<Dp>, b: Dp) -> Dp {
    match a {
        None => b,
        Some(a) if a.decimal < b.decimal => a,
        Some(a) if a.decimal == b.decimal => {
            if a.probability > b.probability {
                a
            } else {
                b
            }
        }
        Some(_) => b,
    }
}

fn check_decimal(dp: &mut Dp) {
    if dp.probability < 1e-300 {
        dp.probability *= 1e300;
        dp.decimal += 1;
    }
}

/// 最大概率分词：返回选中的多字词 (起点, 字数)，按起点升序。
fn segment(chars: &[char]) -> Vec<(usize, usize)> {
    let d = dict();
    let n = chars.len();
    // AC 命中序：终点升序；同一终点内由长到短
    let mut matches: Vec<(usize, usize, f64)> = Vec::new();
    let mut key = String::new();
    for end in 0..n {
        let longest = d.max_word_chars.min(end + 1);
        for len in (2..=longest).rev() {
            let start = end + 1 - len;
            key.clear();
            key.extend(&chars[start..=end]);
            if let Some(w) = d.words.get(key.as_str()) {
                matches.push((start, len, w.probability));
            }
        }
    }
    if matches.is_empty() {
        return Vec::new();
    }
    let terminal = Dp {
        probability: 1.0,
        decimal: 0,
        word: None,
        next: n,
    };
    let mut dp: Vec<Option<Dp>> = vec![None; n];
    let mut idx = matches.len();
    for i in (0..n).rev() {
        let suffix = if i + 1 >= n {
            terminal
        } else {
            dp[i + 1].expect("dp filled")
        };
        let next = if suffix.word.is_some() {
            i + 1
        } else {
            suffix.next
        };
        while idx > 0 && matches[idx - 1].0 + matches[idx - 1].1 - 1 == i {
            let (start, len, probability) = matches[idx - 1];
            let mut cur = Dp {
                probability: probability * suffix.probability,
                decimal: suffix.decimal,
                word: Some((start, len)),
                next,
            };
            check_decimal(&mut cur);
            dp[start] = Some(better(dp[start], cur));
            idx -= 1;
        }
        let mut single = Dp {
            probability: PROB_UNKNOWN * suffix.probability,
            decimal: 0,
            word: None,
            next,
        };
        check_decimal(&mut single);
        dp[i] = Some(better(dp[i], single));
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let item = dp[i].expect("dp filled");
        if let Some(w) = item.word {
            out.push(w);
        }
        i = item.next;
    }
    out
}

fn single_char(chars: &[char], i: usize, has_repeat_mark: bool) -> &'static str {
    let d = dict();
    let cur = chars[i];
    let pre = if i > 0 { Some(chars[i - 1]) } else { None };
    let pre_known = pre.and_then(|p| d.chars.get(&p).copied());
    if has_repeat_mark && cur == '々' {
        return pre_known.unwrap_or("tong");
    }
    if cur == '了' && pre_known.is_none() {
        return "liao";
    }
    d.chars.get(&cur).copied().unwrap_or("")
}

fn syllables(text: &str) -> Vec<Syllable> {
    let d = dict();
    let chars: Vec<char> = text.chars().collect();
    let words = segment(&chars);
    let has_repeat_mark = chars.contains(&'々');
    let mut out = Vec::with_capacity(chars.len());
    let mut w = 0;
    let mut i = 0;
    while i < chars.len() {
        if let Some(&(start, len)) = words.get(w) {
            if start == i {
                let key: String = chars[start..start + len].iter().collect();
                let word = &d.words[key.as_str()];
                for j in 0..len {
                    out.push(Syllable {
                        text: word.syllables.get(j).copied().unwrap_or("").to_string(),
                        is_zh: true,
                    });
                }
                i += len;
                w += 1;
                continue;
            }
        }
        let py = single_char(&chars, i, has_repeat_mark);
        if py.is_empty() {
            out.push(Syllable {
                text: chars[i].to_string(),
                is_zh: false,
            });
        } else {
            out.push(Syllable {
                text: py.to_string(),
                is_zh: true,
            });
        }
        i += 1;
    }
    out
}

/// 全拼（无声调、无分隔）：非汉字原样保留。
pub fn full(text: &str) -> String {
    syllables(text).into_iter().map(|s| s.text).collect()
}

/// 首字母：汉字取读音首字母，非汉字原样保留。
pub fn initials(text: &str) -> String {
    syllables(text)
        .into_iter()
        .map(|s| {
            if s.is_zh {
                s.text.chars().next().map(String::from).unwrap_or_default()
            } else {
                s.text
            }
        })
        .collect()
}

/// 一次分词同时得到全拼与首字母。
pub fn full_and_initials(text: &str) -> (String, String) {
    let mut full = String::new();
    let mut initials = String::new();
    for s in syllables(text) {
        if s.is_zh {
            if let Some(c) = s.text.chars().next() {
                initials.push(c);
            }
        } else {
            initials.push_str(&s.text);
        }
        full.push_str(&s.text);
    }
    (full, initials)
}

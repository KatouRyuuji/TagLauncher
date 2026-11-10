//! 名称排序规则：与前端 `Intl.Collator("zh-CN", { numeric: true })` 同一 CLDR 规则（ICU4X）。

use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::OnceLock;

use icu_collator::options::CollatorOptions;
use icu_collator::preferences::CollationNumericOrdering;
use icu_collator::{Collator, CollatorBorrowed, CollatorPreferences};

fn collator() -> &'static CollatorBorrowed<'static> {
    static C: OnceLock<CollatorBorrowed<'static>> = OnceLock::new();
    C.get_or_init(|| {
        let mut prefs: CollatorPreferences = icu_locale_core::locale!("zh-CN").into();
        prefs.numeric_ordering = Some(CollationNumericOrdering::True);
        Collator::try_new(prefs, CollatorOptions::default())
            .expect("zh-CN 排序规则数据已编译进二进制")
    })
}

pub fn compare_names(a: &str, b: &str) -> Ordering {
    collator().compare(a, b)
}

/// 给一组名称排名次：比较为 0 的同名次（保持 JS 稳定排序下的平局语义）。
pub fn rank_names<'a>(names: impl IntoIterator<Item = &'a str>) -> HashMap<String, u32> {
    let mut uniq: Vec<&str> = names.into_iter().collect();
    uniq.sort_unstable();
    uniq.dedup();
    uniq.sort_by(|a, b| compare_names(a, b));
    let mut ranks = HashMap::with_capacity(uniq.len());
    let mut rank = 0u32;
    for (i, name) in uniq.iter().enumerate() {
        if i > 0 && compare_names(uniq[i - 1], name) != Ordering::Equal {
            rank += 1;
        }
        ranks.insert((*name).to_string(), rank);
    }
    ranks
}

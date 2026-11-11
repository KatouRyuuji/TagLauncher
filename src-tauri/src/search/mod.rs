//! 搜索内核（纯逻辑，不依赖 Tauri/数据库）：拼音派生 + 表达式打分排序。
//! 索引的维护与命令在 services::search_service。

pub mod engine;
pub mod pinyin;

#[cfg(test)]
mod corpus_tests;
#[cfg(test)]
mod design_tests;

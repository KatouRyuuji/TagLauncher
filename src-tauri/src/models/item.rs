use serde::{Deserialize, Serialize};
use super::tag::Tag;

/// 项目（文件/文件夹）数据结构
/// 与前端 TypeScript 的 Item 接口一一对应
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub icon_path: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub is_favorite: bool,
}

/// 带标签的项目（用于前端展示）
#[derive(Debug, Serialize, Deserialize)]
pub struct ItemWithTags {
    #[serde(flatten)]
    pub item: Item,
    pub tags: Vec<Tag>,
}

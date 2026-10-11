use serde::{Deserialize, Serialize};

/// 标签数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    /// 侧栏手动顺序，升序；相同值按界面默认规则排
    #[serde(default)]
    pub sort_order: i64,
}

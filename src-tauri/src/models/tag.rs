use serde::{Deserialize, Serialize};

/// 标签数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
}

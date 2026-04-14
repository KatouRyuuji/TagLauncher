use serde::{Deserialize, Serialize};

/// 文件柜数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cabinet {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

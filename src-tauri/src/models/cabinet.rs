use serde::{Deserialize, Serialize};

/// 文件柜数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cabinet {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
    /// 关联的磁盘文件夹；None 为普通柜（成员手动维护）
    pub folder_path: Option<String>,
    /// 最近一次同步因单柜上限截断
    pub folder_truncated: bool,
    /// 关联文件夹状态："ok" | "offline"（所在盘不可用）| "missing"（盘在、文件夹不在）；
    /// 仅 GUI 命令层在锁外填写，其余调用方为 None
    #[serde(default)]
    pub folder_state: Option<String>,
}

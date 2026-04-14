use serde::{Deserialize, Serialize};

/// 应用设置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub enabled_mods: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            enabled_mods: Vec::new(),
        }
    }
}

/// 主题定义
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    pub variables: std::collections::HashMap<String, String>,
    /// 是否为内置预设主题
    #[serde(default)]
    pub is_preset: bool,
    /// 原始 CSS 注入字符串（用于变量无法覆盖的深度定制）
    #[serde(default)]
    pub css: Option<String>,
}

/// Mod 清单
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    /// "css" | "theme" | "css+js"
    #[serde(rename = "type")]
    pub mod_type: String,
    #[serde(default)]
    pub entrypoints: ModEntrypoints,
    #[serde(default)]
    pub min_app_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModEntrypoints {
    pub css: Option<String>,
    pub js: Option<String>,
    pub theme: Option<String>,
}

/// Mod 信息（含运行时状态）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModInfo {
    #[serde(flatten)]
    pub manifest: ModManifest,
    pub enabled: bool,
    pub path: String,
}

/// 迁移结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MigrationResult {
    pub from_version: u32,
    pub to_version: u32,
    pub applied: Vec<String>,
    pub has_breaking: bool,
}

/// 版本信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionInfo {
    pub current: String,
    pub latest: Option<String>,
    pub has_update: bool,
    pub download_url: Option<String>,
}

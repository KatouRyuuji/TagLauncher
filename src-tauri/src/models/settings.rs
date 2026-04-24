use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    pub variables: HashMap<String, String>,
    /// 是否为内置预设主题
    #[serde(default, alias = "isPreset")]
    pub is_preset: bool,
    /// 原始 CSS 注入字符串（用于变量无法覆盖的深度定制）
    #[serde(default)]
    pub css: Option<String>,
    /// 主题来源：preset / custom / mod
    #[serde(default)]
    pub source: Option<String>,
    /// 对应文件名（仅自定义主题有值）
    #[serde(default, alias = "fileName")]
    pub file_name: Option<String>,
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
    /// 最高兼容版本（exclusive）：App > 此版本时标记不兼容（如 mod 依赖已移除的 API）
    #[serde(default)]
    pub max_app_version: Option<String>,
    /// 权限声明（items:read / tags:read / cabinets:read / storage / dom / theme）
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Mod 所针对的 API 版本（如 "2.1.0"）
    #[serde(default)]
    pub api_version: Option<String>,
    /// Mod 间通信事件约定
    #[serde(default)]
    pub events: Option<ModEvents>,
    /// 依赖声明：modId → 版本要求（如 "^1.0.0"、">=2.0.0"）
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
    /// 加载顺序控制：确保在这些 mod 之后加载
    #[serde(default, rename = "load_after")]
    pub load_after: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModEvents {
    #[serde(default)]
    pub exports: Vec<String>,
    #[serde(default)]
    pub imports: Vec<String>,
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
    /// 是否与当前 App 版本兼容（min_app_version 校验结果）
    pub is_compatible: bool,
    /// 不兼容原因（is_compatible 为 false 时填充）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incompatible_reason: Option<String>,
}

/// Mod 加载错误（manifest 解析失败等）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModLoadError {
    /// Mod 目录名
    pub dir_name: String,
    /// 错误描述
    pub error: String,
}

/// 自定义主题加载结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomThemesResult {
    pub themes: Vec<ThemeDefinition>,
    /// 加载失败的主题文件名及错误信息
    pub errors: Vec<ThemeLoadError>,
}

/// 主题加载错误
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeLoadError {
    pub file_name: String,
    pub error: String,
}

/// 主题校验项
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeValidationIssue {
    pub level: String,
    pub message: String,
}

/// 导入主题结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeInstallResult {
    pub theme: ThemeDefinition,
    pub replaced: bool,
    pub file_path: String,
    pub validation_issues: Vec<ThemeValidationIssue>,
}

/// 导出主题内容
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeExportPayload {
    pub theme: ThemeDefinition,
    pub file_name: String,
    pub json: String,
}

/// 主题目录信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeDirectoryInfo {
    pub themes_dir: String,
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

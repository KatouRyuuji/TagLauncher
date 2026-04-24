use crate::models::{
    CustomThemesResult, ThemeDefinition, ThemeExportPayload, ThemeInstallResult, ThemeLoadError,
    ThemeValidationIssue,
};
use std::collections::HashSet;
use std::path::Path;

const REQUIRED_VARIABLES: &[&str] = &[
    "font-family",
    "font-family-mono",
    "font-size-xs",
    "font-size-sm",
    "font-size-base",
    "font-size-lg",
    "font-size-xl",
    "font-weight-normal",
    "font-weight-medium",
    "font-weight-bold",
    "line-height-tight",
    "line-height-normal",
    "letter-spacing",
    "radius-sm",
    "radius-md",
    "radius-lg",
    "radius-xl",
    "radius-full",
    "shadow-sm",
    "shadow-md",
    "shadow-lg",
    "shadow-overlay",
    "shadow-dropdown",
    "shadow-card",
    "shadow-glow",
    "spacing-unit",
    "spacing-xs",
    "spacing-sm",
    "spacing-md",
    "spacing-lg",
    "spacing-xl",
    "transition-fast",
    "transition-normal",
    "transition-slow",
    "bg-gradient",
    "card-backdrop-filter",
    "sidebar-backdrop-filter",
    "welcome-accent-gradient",
    "media-caption-gradient",
    "status-warning-bg",
    "status-success-bg",
    "tag-preset-colors",
    "sidebar-width",
    "grid-col-min",
    "header-height",
    "bg-base",
    "bg-surface",
    "bg-card",
    "bg-hover",
    "bg-active",
    "bg-overlay",
    "bg-elevated",
    "bg-card-hover",
    "bg-input",
    "text-primary",
    "text-secondary",
    "text-tertiary",
    "text-muted",
    "text-faint",
    "text-ghost",
    "text-placeholder",
    "text-invert",
    "border-subtle",
    "border-default",
    "border-medium",
    "border-strong",
    "accent-primary",
    "accent-primary-hover",
    "accent-primary-bg",
    "accent-primary-bg-light",
    "color-danger",
    "color-danger-hover",
    "color-danger-bg",
    "color-warning",
    "color-success",
    "color-favorite",
    "overlay-bg",
    "scrollbar-thumb",
    "scrollbar-thumb-hover",
    "z-bg-decoration",
    "z-context-overlay",
    "z-context-menu",
    "z-context-submenu",
    "z-drag-ghost",
    "z-welcome-modal",
    "z-floating-panel",
    "z-settings-overlay",
    "z-settings-panel",
    "z-mod-confirm-overlay",
    "z-mod-confirm-panel",
    "z-migration-overlay",
    "z-migration-panel",
    "z-toast",
    "drag-ghost-offset-x",
    "drag-ghost-offset-y",
    "tag-color-alpha",
    "tag-selected-alpha",
    "tag-muted-alpha",
    "tag-selected-border-alpha",
    "border-width",
    "border-style",
    "panel-floating-min-width",
    "panel-floating-min-height",
    "panel-floating-border-radius",
    "panel-titlebar-height",
    "panel-titlebar-bg",
    "panel-body-bg",
    "panel-border-color",
];

const RESERVED_THEME_IDS: &[&str] = &["dark", "light", "sakura"];

/// 从目录加载自定义主题文件，返回成功列表与错误列表
pub fn load_custom_themes(themes_dir: &Path) -> CustomThemesResult {
    let mut themes = Vec::new();
    let mut errors = Vec::new();
    let mut seen_ids = HashSet::new();

    let entries = match std::fs::read_dir(themes_dir) {
        Ok(entries) => entries,
        Err(e) => {
            errors.push(ThemeLoadError {
                file_name: themes_dir
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "themes".to_string()),
                error: format!("无法读取主题目录: {}", e),
            });
            return CustomThemesResult { themes, errors };
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let manifest_path = if path.is_dir() {
            path.join("theme.json")
        } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
            path.clone()
        } else {
            continue;
        };

        let file_name = manifest_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "theme.json".to_string());

        let content = match std::fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(e) => {
                errors.push(ThemeLoadError {
                    file_name,
                    error: format!("无法读取文件: {}", e),
                });
                continue;
            }
        };

        let mut theme: ThemeDefinition = match parse_theme_json(&content) {
            Ok(t) => t,
            Err(e) => {
                errors.push(ThemeLoadError {
                    file_name,
                    error: e,
                });
                continue;
            }
        };

        if let Err(error) = validate_theme_for_loading(&theme) {
            errors.push(ThemeLoadError { file_name, error });
            continue;
        }

        if RESERVED_THEME_IDS.contains(&theme.id.as_str()) {
            errors.push(ThemeLoadError {
                file_name,
                error: format!("主题 ID '{}' 与内置主题冲突", theme.id),
            });
            continue;
        }

        if !seen_ids.insert(theme.id.clone()) {
            errors.push(ThemeLoadError {
                file_name,
                error: format!("主题 ID '{}' 与其他自定义主题重复", theme.id),
            });
            continue;
        }

        theme.is_preset = false;
        theme.source = Some("custom".to_string());
        theme.file_name = Some(
            manifest_path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "theme.json".to_string()),
        );
        themes.push(theme);
    }

    CustomThemesResult { themes, errors }
}

/// 从任意路径安装主题 JSON 或主题包目录到 Plugins_Theme，并返回标准化主题。
pub fn install_theme_file(
    themes_dir: &Path,
    source_path: &Path,
) -> Result<ThemeInstallResult, String> {
    std::fs::create_dir_all(themes_dir).map_err(|e| format!("无法创建主题目录: {}", e))?;

    let manifest_path = if source_path.is_dir() {
        source_path.join("theme.json")
    } else if source_path.extension().and_then(|e| e.to_str()) == Some("json") {
        source_path.to_path_buf()
    } else {
        return Err("请选择 .json 主题文件或包含 theme.json 的主题包目录".to_string());
    };

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("无法读取主题文件: {}", e))?;
    let mut theme = parse_theme_json(&content)?;
    validate_theme_for_loading(&theme)?;

    if RESERVED_THEME_IDS.contains(&theme.id.as_str()) {
        return Err(format!(
            "主题 ID '{}' 与内置主题冲突，请修改 id 后再导入",
            theme.id
        ));
    }

    let validation_issues = validate_theme_contract(&theme);
    let file_stem = sanitize_theme_file_stem(&theme.id);
    let file_name = if source_path.is_dir() {
        "theme.json".to_string()
    } else {
        format!("{}.json", file_stem)
    };
    let target_path = if source_path.is_dir() {
        themes_dir.join(&file_stem)
    } else {
        themes_dir.join(&file_name)
    };
    let replaced = target_path.exists();

    theme.is_preset = false;
    theme.source = Some("custom".to_string());
    theme.file_name = Some(file_name);

    if source_path.is_dir() {
        if replaced {
            std::fs::remove_dir_all(&target_path).map_err(|e| format!("无法替换主题包: {}", e))?;
        }
        copy_dir_all(source_path, &target_path)?;
        let payload = theme_to_pretty_json(&theme)?;
        std::fs::write(target_path.join("theme.json"), payload)
            .map_err(|e| format!("无法写入主题文件: {}", e))?;
    } else {
        let payload = theme_to_pretty_json(&theme)?;
        std::fs::write(&target_path, payload).map_err(|e| format!("无法写入主题文件: {}", e))?;
    }

    Ok(ThemeInstallResult {
        theme,
        replaced,
        file_path: target_path.to_string_lossy().to_string(),
        validation_issues,
    })
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 写出主题 JSON 到用户选择的位置。
pub fn export_theme_file(
    theme: ThemeDefinition,
    target_path: &Path,
) -> Result<ThemeExportPayload, String> {
    let file_name = target_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.json", sanitize_theme_file_stem(&theme.id)));
    let json = theme_to_pretty_json(&theme)?;

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建导出目录: {}", e))?;
    }
    std::fs::write(target_path, &json).map_err(|e| format!("无法写入导出文件: {}", e))?;

    Ok(ThemeExportPayload {
        theme,
        file_name,
        json,
    })
}

fn parse_theme_json(content: &str) -> Result<ThemeDefinition, String> {
    serde_json::from_str(content).map_err(|e| format!("JSON 格式错误: {}", e))
}

fn validate_theme_for_loading(theme: &ThemeDefinition) -> Result<(), String> {
    if theme.id.trim().is_empty() {
        return Err("缺少主题 id".to_string());
    }
    if theme.name.trim().is_empty() {
        return Err("缺少主题 name".to_string());
    }
    if theme.variables.is_empty() {
        return Err("缺少 variables 或 variables 为空".to_string());
    }
    if let Some(invalid_key) = theme
        .variables
        .keys()
        .find(|key| key.trim().is_empty() || key.starts_with("--"))
    {
        return Err(format!(
            "变量名 '{}' 无效，变量名不能为空且不应包含 -- 前缀",
            invalid_key
        ));
    }
    Ok(())
}

fn validate_theme_contract(theme: &ThemeDefinition) -> Vec<ThemeValidationIssue> {
    let mut issues = Vec::new();
    for key in REQUIRED_VARIABLES {
        if !theme.variables.contains_key(*key) {
            issues.push(ThemeValidationIssue {
                level: "warning".to_string(),
                message: format!("缺少推荐变量 '{}'", key),
            });
        }
    }
    issues
}

fn sanitize_theme_file_stem(id: &str) -> String {
    let sanitized: String = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "theme".to_string()
    } else {
        trimmed.to_string()
    }
}

fn theme_to_pretty_json(theme: &ThemeDefinition) -> Result<String, String> {
    let mut export_theme = theme.clone();
    export_theme.is_preset = false;
    export_theme.source = None;
    export_theme.file_name = None;
    serde_json::to_string_pretty(&export_theme).map_err(|e| format!("无法序列化主题: {}", e))
}

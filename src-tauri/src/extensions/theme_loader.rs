use crate::models::{CustomThemesResult, ThemeDefinition, ThemeLoadError};
use std::path::Path;

/// 从目录加载自定义主题文件，返回成功列表与错误列表
pub fn load_custom_themes(themes_dir: &Path) -> CustomThemesResult {
    let mut themes = Vec::new();
    let mut errors = Vec::new();

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
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown.json".to_string());

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                errors.push(ThemeLoadError {
                    file_name,
                    error: format!("无法读取文件: {}", e),
                });
                continue;
            }
        };

        let mut theme: ThemeDefinition = match serde_json::from_str(&content) {
            Ok(t) => t,
            Err(e) => {
                errors.push(ThemeLoadError {
                    file_name,
                    error: format!("JSON 格式错误: {}", e),
                });
                continue;
            }
        };

        theme.is_preset = false;
        themes.push(theme);
    }

    CustomThemesResult { themes, errors }
}

use crate::models::ThemeDefinition;
use std::path::Path;

/// 从目录加载自定义主题文件
pub fn load_custom_themes(themes_dir: &Path) -> Vec<ThemeDefinition> {
    let mut themes = Vec::new();

    let entries = match std::fs::read_dir(themes_dir) {
        Ok(entries) => entries,
        Err(_) => return themes,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut theme: ThemeDefinition = match serde_json::from_str(&content) {
            Ok(t) => t,
            Err(_) => continue,
        };

        theme.is_preset = false;
        themes.push(theme);
    }

    themes
}

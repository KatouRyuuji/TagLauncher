use std::collections::HashSet;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

/// 解析同义词文件路径
fn resolve_synonyms_path(app: &AppHandle, default_content: &str) -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .join("synonyms.json");

    if exe_path.exists() {
        return Ok(exe_path);
    }
    if std::fs::write(&exe_path, default_content).is_ok() {
        return Ok(exe_path);
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    let fallback_path = app_data_dir.join("synonyms.json");
    if !fallback_path.exists() {
        std::fs::write(&fallback_path, default_content).map_err(|e| e.to_string())?;
    }
    Ok(fallback_path)
}

/// 读取同义词（合并内置词库与用户词库）
pub fn read_synonyms(app: &AppHandle) -> Result<Vec<Vec<String>>, String> {
    let default = include_str!("../../../src/data/synonyms.json");
    let path = resolve_synonyms_path(app, default)?;

    let builtin_groups: Vec<Vec<String>> =
        serde_json::from_str(default).map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file_groups: Vec<Vec<String>> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for group in builtin_groups.into_iter().chain(file_groups.into_iter()) {
        let cleaned: Vec<String> = group
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if cleaned.is_empty() {
            continue;
        }

        let mut key_words: Vec<String> = cleaned.iter().map(|s| s.to_lowercase()).collect();
        key_words.sort();
        key_words.dedup();
        let key = key_words.join("\u{1f}");
        if seen.insert(key) {
            merged.push(cleaned);
        }
    }
    Ok(merged)
}

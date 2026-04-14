use crate::models::ModManifest;
use std::path::{Path, PathBuf};

/// 扫描 mods 目录，解析所有有效 mod 的 manifest
pub fn discover_mods(mods_dir: &Path) -> Vec<(ModManifest, PathBuf)> {
    let mut result = Vec::new();

    let entries = match std::fs::read_dir(mods_dir) {
        Ok(entries) => entries,
        Err(_) => return result,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let manifest: ModManifest = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(_) => continue,
        };

        result.push((manifest, path));
    }

    result
}

/// 读取 mod 的入口文件内容
pub fn read_mod_entrypoint(mod_dir: &Path, filename: &str) -> Result<String, String> {
    let file_path = mod_dir.join(filename);
    if !file_path.exists() {
        return Err(format!("Entrypoint not found: {}", filename));
    }
    // 安全检查：确保路径不逃出 mod 目录
    let canonical_dir = mod_dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_file = file_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err("Path traversal detected".to_string());
    }
    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

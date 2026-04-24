use crate::models::{ModLoadError, ModManifest};
use std::path::{Path, PathBuf};

/// 扫描 mods 目录，解析所有有效 mod 的 manifest。
/// 返回 (成功列表, 失败列表)。
pub fn discover_mods(mods_dir: &Path) -> (Vec<(ModManifest, PathBuf)>, Vec<ModLoadError>) {
    let mut result = Vec::new();
    let mut errors = Vec::new();

    let entries = match std::fs::read_dir(mods_dir) {
        Ok(entries) => entries,
        Err(_) => return (result, errors),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            // 没有 manifest.json 的目录静默跳过（不视为错误）
            continue;
        }

        let content = match std::fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(e) => {
                errors.push(ModLoadError {
                    dir_name,
                    error: format!("无法读取 manifest.json: {}", e),
                });
                continue;
            }
        };

        let manifest: ModManifest = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                errors.push(ModLoadError {
                    dir_name,
                    error: format!("manifest.json 格式错误: {}", e),
                });
                continue;
            }
        };

        result.push((manifest, path));
    }

    (result, errors)
}

/// 简单语义版本比较：current >= required
/// 仅解析 "x.y.z" 格式，忽略预发布标记
pub fn semver_gte(current: &str, required: &str) -> bool {
    let parse = |s: &str| -> (u32, u32, u32) {
        let parts: Vec<u32> = s
            .split('.')
            .take(3)
            .map(|p| p.split('-').next().unwrap_or("0").parse().unwrap_or(0))
            .collect();
        (
            parts.first().copied().unwrap_or(0),
            parts.get(1).copied().unwrap_or(0),
            parts.get(2).copied().unwrap_or(0),
        )
    };
    parse(current) >= parse(required)
}

/// 语义版本范围匹配（支持 ^x.y.z、>=x.y.z 和精确匹配）
pub fn semver_satisfies(version: &str, range: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.')
            .take(3)
            .map(|p| p.split('-').next().unwrap_or("0").parse().unwrap_or(0))
            .collect()
    };
    let v = parse(version);
    let range_trimmed = range.trim();

    if range_trimmed.starts_with('^') {
        let r = parse(&range_trimmed[1..]);
        if v.first().copied().unwrap_or(0) != r.first().copied().unwrap_or(0) {
            return false;
        }
        for i in 0..3 {
            let vi = v.get(i).copied().unwrap_or(0);
            let ri = r.get(i).copied().unwrap_or(0);
            if vi > ri {
                return true;
            }
            if vi < ri {
                return false;
            }
        }
        return true;
    }

    if range_trimmed.starts_with(">=") {
        let r = parse(&range_trimmed[2..]);
        for i in 0..3 {
            let vi = v.get(i).copied().unwrap_or(0);
            let ri = r.get(i).copied().unwrap_or(0);
            if vi > ri {
                return true;
            }
            if vi < ri {
                return false;
            }
        }
        return true;
    }

    // 精确匹配
    version == range
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

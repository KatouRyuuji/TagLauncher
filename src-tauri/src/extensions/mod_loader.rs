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

        // id 字符集在载入期即校验（与 mod_commands::ensure_valid_mod_id 同一规则）：
        // 否则含中文/空格等 id 的 mod 能加载，但其 kv/record/file 命令会在调用期全被拒，
        // 故障面割裂且报错不指向根因。
        if !is_valid_mod_id(&manifest.id) {
            errors.push(ModLoadError {
                dir_name,
                error: format!(
                    "mod id \"{}\" 非法：仅允许字母、数字及 . _ -，且 ≤128 字符",
                    manifest.id
                ),
            });
            continue;
        }

        result.push((manifest, path));
    }

    (result, errors)
}

/// mod id 合法性：与 mod_commands::ensure_valid_mod_id 同一规则（载入期与命令期一致）。
/// 追加排除全点号 id（"." / ".." / "..."）：字符集允许 '.'，但这类 id 直接拼目录即路径逃逸。
/// pub 供 mod_commands::import_mod 在导入期复用同一规则。
pub fn is_valid_mod_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && id.chars().any(|c| c != '.')
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

/// 语义版本范围匹配（支持 ^x.y.z、>=x.y.z 和精确匹配）。
///
/// 注意：须与前端 `modRuntime.ts::semverSatisfies` 保持同款语义（二者算法一致）。
/// 未改用 `semver` crate 是受本轮改动文件范围约束（不新增 Cargo.toml 依赖）；
/// 若后续统一为库实现，请前后端一并替换。
///
/// 已知偏差（与标准 semver 不同，前后端一致的简化）：`^0.x.y` 只钉主版本号，
/// 不钉 minor（标准 semver 中 ^0.9.0 等价 >=0.9.0 <0.10.0，此处会放行 0.10.0）；
/// 预发布段在解析时被忽略（"1.2.0-beta" 按 "1.2.0" 参与比较）。
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_gte_compares_major_minor_patch() {
        assert!(semver_gte("1.2.0", "1.1.0"));
        assert!(semver_gte("1.1.0", "1.1.0"));
        assert!(semver_gte("2.0.0", "1.9.9"));
        assert!(!semver_gte("1.0.0", "1.1.0"));
        assert!(!semver_gte("0.9.9", "1.0.0"));
    }

    #[test]
    fn semver_satisfies_caret_gte_and_exact() {
        // ^：同主版本且 >= 指定
        assert!(semver_satisfies("1.2.3", "^1.0.0"));
        assert!(semver_satisfies("1.0.0", "^1.0.0"));
        assert!(!semver_satisfies("2.0.0", "^1.0.0"));
        assert!(!semver_satisfies("0.9.0", "^1.0.0"));
        // >=：大于等于
        assert!(semver_satisfies("1.5.0", ">=1.0.0"));
        assert!(!semver_satisfies("0.9.0", ">=1.0.0"));
        // 精确匹配
        assert!(semver_satisfies("1.0.0", "1.0.0"));
        assert!(!semver_satisfies("1.0.1", "1.0.0"));
    }
}

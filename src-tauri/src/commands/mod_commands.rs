use crate::db::Database;
use crate::extensions::mod_loader;
use crate::extensions::mod_registry::ModRegistry;
use crate::models::{ModInfo, ModLoadError, ModManifest};
use crate::services::path_service;
use crate::services::settings_service;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn get_mods(registry: State<ModRegistry>) -> Vec<ModInfo> {
    registry.list_mods()
}

/// 获取启动时收集的所有 mod 加载错误（manifest 解析失败 / enabled_mods 损坏等）
#[tauri::command]
pub fn get_mod_load_errors(registry: State<ModRegistry>) -> Vec<ModLoadError> {
    registry.get_load_errors()
}

#[tauri::command]
pub fn get_mod_content(
    registry: State<ModRegistry>,
    mod_id: String,
    entrypoint: String,
) -> Result<String, String> {
    let mod_path = registry
        .get_mod_path(&mod_id)
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;
    mod_loader::read_mod_entrypoint(&mod_path, &entrypoint)
}

/// 返回 mod 的绝对目录路径（注册表中的真实目录，目录名可能与 id 不同）。
/// 前端用于解析 mod 主题包内 assets/fonts 的相对路径。
#[tauri::command]
pub fn get_mod_dir(registry: State<ModRegistry>, mod_id: String) -> Result<String, String> {
    registry
        .get_mod_path(&mod_id)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))
}

#[tauri::command]
pub fn enable_mod(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
) -> Result<(), String> {
    if !registry.enable_mod(&mod_id) {
        return Err(format!("Mod '{}' not found", mod_id));
    }
    let conn = db.get_conn();
    let (mut enabled, parse_err) = settings_service::get_enabled_mods(&conn);
    if let Some(err) = parse_err {
        // 解析失败时 get_enabled_mods 返回空列表，若继续写回会把其它已启用 Mod 全部丢弃
        return Err(format!(
            "enabled_mods 配置已损坏，为避免覆盖已启用列表，本次启用未落库：{}",
            err
        ));
    }
    if !enabled.contains(&mod_id) {
        enabled.push(mod_id);
    }
    settings_service::set_enabled_mods(&conn, &enabled)
}

#[tauri::command]
pub fn disable_mod(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
) -> Result<(), String> {
    if !registry.disable_mod(&mod_id) {
        return Err(format!("Mod '{}' not found", mod_id));
    }
    let conn = db.get_conn();
    let (mut enabled, parse_err) = settings_service::get_enabled_mods(&conn);
    if let Some(err) = parse_err {
        // 同上：损坏状态下写回空列表会误伤其它已启用 Mod
        return Err(format!(
            "enabled_mods 配置已损坏，为避免覆盖已启用列表，本次禁用未落库：{}",
            err
        ));
    }
    enabled.retain(|id| id != &mod_id);
    settings_service::set_enabled_mods(&conn, &enabled)
}

#[tauri::command]
pub fn delete_mod(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
) -> Result<(), String> {
    // 1. 确保 mod 存在
    let mod_path = registry
        .get_mod_path(&mod_id)
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

    // 2. 从 enabled_mods 中移除（如果存在），并清理该 mod 在 SQLite 中的持久化数据
    {
        let conn = db.get_conn();
        let (mut enabled, _) = settings_service::get_enabled_mods(&conn);
        if enabled.contains(&mod_id) {
            enabled.retain(|id| id != &mod_id);
            settings_service::set_enabled_mods(&conn, &enabled)?;
        }

        // 卸载时一并清理 mod 专属数据表，避免残留孤儿数据
        conn.execute("DELETE FROM mod_kv WHERE mod_id = ?1", [&mod_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM mod_records WHERE mod_id = ?1", [&mod_id])
            .map_err(|e| e.to_string())?;
    }

    // 3. 删除 mod 目录（递归）
    if mod_path.exists() {
        std::fs::remove_dir_all(&mod_path).map_err(|e| format!("删除 mod 目录失败: {}", e))?;
    }

    // 4. 从注册表中注销
    registry.unregister(&mod_id);

    Ok(())
}

#[tauri::command]
pub fn get_mod_install_state(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
) -> Result<String, String> {
    let manifest = registry
        .get_mod_manifest(&mod_id)
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

    let conn = db.get_conn();
    let key = format!("mod_version::{}", mod_id);
    match settings_service::get_setting(&conn, &key) {
        None => Ok("new".to_string()),
        Some(old_version) if old_version != manifest.version => {
            Ok(format!("updated:{}", old_version))
        }
        _ => Ok("unchanged".to_string()),
    }
}

#[tauri::command]
pub fn mark_mod_version(
    db: State<Database>,
    mod_id: String,
    version: String,
) -> Result<(), String> {
    let conn = db.get_conn();
    let key = format!("mod_version::{}", mod_id);
    settings_service::set_setting(&conn, &key, &version)
}

// ============================================================================
// Mod 数据 API
// ============================================================================

/// 校验 mod_id：非空、长度受限、仅含合法字符（字母/数字/`.`/`_`/`-`），
/// 且已在注册表中存在。可信模型下用于挡明显越权 / 非法 id（非强身份校验）。
/// pub 以便集成测试验证 kv/record/file 命令共用的 id 合法性 + 注册表存在性校验。
pub fn ensure_valid_mod_id(registry: &ModRegistry, mod_id: &str) -> Result<(), String> {
    if mod_id.is_empty() || mod_id.len() > 128 {
        return Err("非法的 mod id".to_string());
    }
    if !mod_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err("mod id 含非法字符".to_string());
    }
    if registry.get_mod_path(mod_id).is_none() {
        return Err(format!("Mod '{}' not found", mod_id));
    }
    Ok(())
}

#[tauri::command]
pub fn mod_kv_get(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
    key: String,
) -> Result<Option<String>, String> {
    ensure_valid_mod_id(&registry, &mod_id)?;
    let conn = db.get_conn();
    conn.query_row(
        "SELECT value FROM mod_kv WHERE mod_id = ?1 AND key = ?2",
        [&mod_id, &key],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        _ => Err(e.to_string()),
    })
}

#[tauri::command]
pub fn mod_kv_set(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    ensure_valid_mod_id(&registry, &mod_id)?;
    let conn = db.get_conn();
    conn.execute(
        "INSERT OR REPLACE INTO mod_kv (mod_id, key, value, updated_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)",
        [&mod_id, &key, &value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mod_kv_remove(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
    key: String,
) -> Result<(), String> {
    ensure_valid_mod_id(&registry, &mod_id)?;
    let conn = db.get_conn();
    conn.execute("DELETE FROM mod_kv WHERE mod_id = ?1 AND key = ?2", [&mod_id, &key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mod_records_list(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
    collection: String,
) -> Result<Vec<String>, String> {
    ensure_valid_mod_id(&registry, &mod_id)?;
    let conn = db.get_conn();
    let mut stmt = conn
        .prepare("SELECT value FROM mod_records WHERE mod_id = ?1 AND collection = ?2 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&mod_id, &collection], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mod_record_put(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
    collection: String,
    id: String,
    value: String,
) -> Result<(), String> {
    ensure_valid_mod_id(&registry, &mod_id)?;
    let conn = db.get_conn();
    conn.execute(
        "INSERT OR REPLACE INTO mod_records (mod_id, collection, id, value, updated_at) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
        [&mod_id, &collection, &id, &value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mod_record_remove(
    db: State<Database>,
    registry: State<ModRegistry>,
    mod_id: String,
    collection: String,
    id: String,
) -> Result<(), String> {
    ensure_valid_mod_id(&registry, &mod_id)?;
    let conn = db.get_conn();
    conn.execute(
        "DELETE FROM mod_records WHERE mod_id = ?1 AND collection = ?2 AND id = ?3",
        [&mod_id, &collection, &id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Mod 文件系统 API
// ============================================================================

#[derive(Serialize)]
pub struct ModFileEntry {
    pub name: String,
    pub is_file: bool,
    pub is_dir: bool,
}

/// 校验 relative_path 不逃出 mod 目录，返回绝对路径
/// pub 以便集成测试验证 mod 文件 API 的目录逃逸（../、绝对路径）防御。
pub fn resolve_mod_file_path(
    registry: &ModRegistry,
    mod_id: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    ensure_valid_mod_id(registry, mod_id)?;
    let mod_path = registry
        .get_mod_path(mod_id)
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

    let canonical_mod = mod_path.canonicalize().map_err(|e| e.to_string())?;
    let target = canonical_mod.join(relative_path);

    if target.exists() {
        let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_mod) {
            return Err("Path traversal detected".to_string());
        }
        Ok(canonical_target)
    } else {
        // 目标不存在时（如写入新文件），手动校验组件不逃出目录
        let mut check = canonical_mod.clone();
        for component in std::path::Path::new(relative_path).components() {
            match component {
                std::path::Component::Normal(name) => check.push(name),
                std::path::Component::ParentDir => {
                    if !check.pop() {
                        return Err("Path traversal detected".to_string());
                    }
                }
                std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                    return Err("Absolute path not allowed".to_string());
                }
                std::path::Component::CurDir => {}
            }
        }
        if !check.starts_with(&canonical_mod) {
            return Err("Path traversal detected".to_string());
        }
        Ok(target)
    }
}

/// Mod 文件读写大小上限（32 MiB）：mod 可读写自身目录文件（可信模型），
/// 但不设限时一次误读/误写超大文件会把整个缓冲区灌进 IPC 与内存。
const MAX_MOD_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// 读前检查文件大小，超限拒绝（避免一次性读入超大文件）。
fn ensure_file_size_within_limit(path: &Path) -> Result<(), String> {
    let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if len > MAX_MOD_FILE_BYTES {
        return Err(format!(
            "文件过大（{} 字节），超过 mod 文件读写上限 {} 字节",
            len, MAX_MOD_FILE_BYTES
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn read_mod_file(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
) -> Result<String, String> {
    let path = resolve_mod_file_path(&registry, &mod_id, &relative_path)?;
    if !path.is_file() {
        return Err("Path is not a file".to_string());
    }
    ensure_file_size_within_limit(&path)?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_mod_file_bytes(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    let path = resolve_mod_file_path(&registry, &mod_id, &relative_path)?;
    if !path.is_file() {
        return Err("Path is not a file".to_string());
    }
    ensure_file_size_within_limit(&path)?;
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_mod_file(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    if content.len() as u64 > MAX_MOD_FILE_BYTES {
        return Err(format!(
            "写入内容过大（{} 字节），超过 mod 文件写入上限 {} 字节",
            content.len(),
            MAX_MOD_FILE_BYTES
        ));
    }
    let path = resolve_mod_file_path(&registry, &mod_id, &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_mod_file_bytes(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.len() as u64 > MAX_MOD_FILE_BYTES {
        return Err(format!(
            "写入内容过大（{} 字节），超过 mod 文件写入上限 {} 字节",
            bytes.len(),
            MAX_MOD_FILE_BYTES
        ));
    }
    let path = resolve_mod_file_path(&registry, &mod_id, &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_mod_files(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
) -> Result<Vec<ModFileEntry>, String> {
    let path = resolve_mod_file_path(&registry, &mod_id, &relative_path)?;
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(ModFileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_file: meta.is_file(),
            is_dir: meta.is_dir(),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn remove_mod_file(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
) -> Result<(), String> {
    let path = resolve_mod_file_path(&registry, &mod_id, &relative_path)?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    } else if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        Err("Path does not exist".to_string())
    }
}

// ============================================================================
// Mod 导入导出
// ============================================================================

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> Result<(), String> {
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.as_ref().join(entry.file_name());
        // 与 theme_loader 一致：不跟随符号链接，避免把包外文件拖入 mod 目录
        let meta = std::fs::symlink_metadata(&src_path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn import_mod(
    app_handle: tauri::AppHandle,
    registry: State<ModRegistry>,
    source_path: String,
) -> Result<ModInfo, String> {
    let source = PathBuf::from(&source_path);
    let manifest_path = source.join("manifest.json");
    if !manifest_path.exists() {
        return Err("所选目录缺少 manifest.json".to_string());
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("无法读取 manifest.json: {}", e))?;
    let manifest: ModManifest = serde_json::from_str(&content)
        .map_err(|e| format!("manifest.json 格式错误: {}", e))?;

    if manifest.id.trim().is_empty() {
        return Err("manifest.json 中缺少 id".to_string());
    }

    // 与启动发现路径同一 id 规则（含全点号排除）：非法 id 的 mod 导入后
    // kv/record/file 命令会在调用期全被拒（故障面割裂）；且 id 直接拼接目标目录，
    // ".."/"." 等形态会造成目录逃逸，必须在复制前拦截。
    if !mod_loader::is_valid_mod_id(&manifest.id) {
        return Err(format!(
            "manifest.json 中的 id \"{}\" 非法：仅允许字母、数字及 . _ -，且 ≤128 字符",
            manifest.id
        ));
    }

    let mods_dir = path_service::resolve_app_paths(&app_handle).mods_dir;
    let target = mods_dir.join(&manifest.id);

    if target.exists() {
        return Err(format!(
            " mods 目录中已存在 id 为 '{}' 的 mod，请删除后再导入",
            manifest.id
        ));
    }

    copy_dir_all(&source, &target)?;

    // 与启动发现路径（lib.rs）一致地做版本兼容判断，不再硬编码 true。
    // 1) min/max_app_version 校验
    let app_version = settings_service::get_app_version();
    let (mut is_compatible, mut incompatible_reason) = {
        let min_ok = match manifest.min_app_version.as_deref() {
            None => Ok(()),
            Some(required) => {
                if mod_loader::semver_gte(app_version, required) {
                    Ok(())
                } else {
                    Err(format!("需要 App >= {}，当前版本为 {}", required, app_version))
                }
            }
        };
        let max_ok = match manifest.max_app_version.as_deref() {
            None => Ok(()),
            Some(max) => {
                if mod_loader::semver_gte(max, app_version) {
                    Ok(())
                } else {
                    Err(format!("此 mod 不兼容 App >= {}，当前版本为 {}", max, app_version))
                }
            }
        };
        match (min_ok, max_ok) {
            (Ok(()), Ok(())) => (true, None),
            (Err(e), _) => (false, Some(e)),
            (_, Err(e)) => (false, Some(e)),
        }
    };

    // 2) 依赖 / load_after 校验（基于已注册的其它 mod 全集）
    if is_compatible {
        let mod_map: std::collections::HashMap<String, ModInfo> = registry
            .list_mods()
            .into_iter()
            .map(|m| (m.manifest.id.clone(), m))
            .collect();

        let mut reasons: Vec<String> = Vec::new();
        for (dep_id, required_ver) in &manifest.dependencies {
            match mod_map.get(dep_id) {
                None => reasons.push(format!("依赖 mod '{}' 不存在", dep_id)),
                Some(dep) if !dep.enabled => {
                    reasons.push(format!("依赖 mod '{}' 未启用", dep_id))
                }
                Some(dep)
                    if !mod_loader::semver_satisfies(&dep.manifest.version, required_ver) =>
                {
                    reasons.push(format!(
                        "依赖 mod '{}' 版本不满足（需要 {}，实际 {}）",
                        dep_id, required_ver, dep.manifest.version
                    ))
                }
                _ => {}
            }
        }
        for after_id in &manifest.load_after {
            if !mod_map.contains_key(after_id) {
                reasons.push(format!("前置 mod '{}' 不存在", after_id));
            }
        }
        if !reasons.is_empty() {
            is_compatible = false;
            incompatible_reason = Some(format!("依赖未满足：{}", reasons.join("；")));
        }
    }

    registry.register(
        manifest.clone(),
        target.clone(),
        false,
        is_compatible,
        incompatible_reason.clone(),
    );

    Ok(ModInfo {
        manifest: manifest.clone(),
        enabled: false,
        path: target.to_string_lossy().to_string(),
        is_compatible,
        incompatible_reason,
    })
}

#[tauri::command]
pub fn export_mod(
    registry: State<ModRegistry>,
    mod_id: String,
    target_dir: String,
) -> Result<String, String> {
    let mod_path = registry
        .get_mod_path(&mod_id)
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;
    let target = PathBuf::from(&target_dir).join(&mod_id);

    if target.exists() {
        return Err(format!("目标目录中已存在 '{}' 文件夹", mod_id));
    }

    copy_dir_all(&mod_path, &target)?;
    Ok(target.to_string_lossy().to_string())
}

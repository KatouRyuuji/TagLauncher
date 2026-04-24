use crate::db::Database;
use crate::extensions::mod_loader;
use crate::extensions::mod_registry::ModRegistry;
use crate::models::{ModInfo, ModLoadError, ModManifest};
use crate::services::settings_service;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

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
    let (mut enabled, _) = settings_service::get_enabled_mods(&conn);
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
    let (mut enabled, _) = settings_service::get_enabled_mods(&conn);
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

    // 2. 从 enabled_mods 中移除（如果存在）
    {
        let conn = db.get_conn();
        let (mut enabled, _) = settings_service::get_enabled_mods(&conn);
        if enabled.contains(&mod_id) {
            enabled.retain(|id| id != &mod_id);
            settings_service::set_enabled_mods(&conn, &enabled)?;
        }
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
// Mod 文件系统 API
// ============================================================================

#[derive(Serialize)]
pub struct ModFileEntry {
    pub name: String,
    pub is_file: bool,
    pub is_dir: bool,
}

/// 校验 relative_path 不逃出 mod 目录，返回绝对路径
fn resolve_mod_file_path(
    registry: &ModRegistry,
    mod_id: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
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
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_mod_file(
    registry: State<ModRegistry>,
    mod_id: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
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
        if src_path.is_dir() {
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

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let mods_dir = app_dir.join("mods");
    let target = mods_dir.join(&manifest.id);

    if target.exists() {
        return Err(format!(
            " mods 目录中已存在 id 为 '{}' 的 mod，请删除后再导入",
            manifest.id
        ));
    }

    copy_dir_all(&source, &target)?;

    let is_compatible = true;
    let incompatible_reason: Option<String> = None;
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

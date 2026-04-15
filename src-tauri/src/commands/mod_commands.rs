use crate::db::Database;
use crate::extensions::mod_loader;
use crate::extensions::mod_registry::ModRegistry;
use crate::models::{ModInfo, ModLoadError};
use crate::services::settings_service;
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

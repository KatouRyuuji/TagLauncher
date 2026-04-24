use crate::db::Database;
use crate::extensions::theme_loader;
use crate::models::{
    CustomThemesResult, ThemeDefinition, ThemeDirectoryInfo, ThemeExportPayload, ThemeInstallResult,
};
use crate::services::path_service;
use crate::services::settings_service;
use std::path::PathBuf;
use tauri::State;

fn get_themes_dir(app: &tauri::AppHandle) -> PathBuf {
    path_service::resolve_app_paths(app).themes_dir
}

#[tauri::command]
pub fn get_app_version() -> String {
    settings_service::get_app_version().to_string()
}

#[tauri::command]
pub fn get_current_theme(db: State<Database>) -> String {
    let conn = db.get_conn();
    settings_service::get_current_theme(&conn)
}

#[tauri::command]
pub fn set_current_theme(db: State<Database>, theme_id: String) -> Result<(), String> {
    let conn = db.get_conn();
    settings_service::set_current_theme(&conn, &theme_id)
}

/// 扫描 Plugins_Theme 目录，返回所有自定义主题（含加载错误）
#[tauri::command]
pub fn get_custom_themes(app: tauri::AppHandle) -> CustomThemesResult {
    let themes_dir = get_themes_dir(&app);
    std::fs::create_dir_all(&themes_dir).ok();
    theme_loader::load_custom_themes(&themes_dir)
}

#[tauri::command]
pub fn get_theme_directory_info(app: tauri::AppHandle) -> ThemeDirectoryInfo {
    let paths = path_service::resolve_app_paths(&app);
    let themes_dir = paths.themes_dir.clone();
    std::fs::create_dir_all(&themes_dir).ok();
    ThemeDirectoryInfo {
        themes_dir: themes_dir.to_string_lossy().to_string(),
        root_dir: paths.root_dir.to_string_lossy().to_string(),
        builtin_dir: paths.builtin_dir.to_string_lossy().to_string(),
        mods_dir: paths.mods_dir.to_string_lossy().to_string(),
        save_dir: paths.save_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn install_theme_file(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<ThemeInstallResult, String> {
    let themes_dir = get_themes_dir(&app);
    let source = PathBuf::from(source_path);
    theme_loader::install_theme_file(&themes_dir, &source)
}

#[tauri::command]
pub fn export_theme_file(
    theme: ThemeDefinition,
    target_path: String,
) -> Result<ThemeExportPayload, String> {
    let target = PathBuf::from(target_path);
    theme_loader::export_theme_file(theme, &target)
}

#[tauri::command]
pub fn get_setting(db: State<Database>, key: String) -> Option<String> {
    let conn = db.get_conn();
    settings_service::get_setting(&conn, &key)
}

#[tauri::command]
pub fn set_setting(db: State<Database>, key: String, value: String) -> Result<(), String> {
    let conn = db.get_conn();
    settings_service::set_setting(&conn, &key, &value)
}

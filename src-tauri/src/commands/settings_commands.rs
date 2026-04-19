use crate::db::Database;
use crate::extensions::theme_loader;
use crate::models::{
    CustomThemesResult, ThemeDefinition, ThemeDirectoryInfo, ThemeExportPayload, ThemeInstallResult,
};
use crate::services::settings_service;
use std::path::PathBuf;
use tauri::{Manager, State};

fn get_themes_dir(app: &tauri::AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    theme_loader::themes_dir_from_app_dir(app_dir)
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

/// 扫描 &lt;AppData&gt;/themes/ 目录，返回所有自定义 JSON 主题（含加载错误）
#[tauri::command]
pub fn get_custom_themes(app: tauri::AppHandle) -> CustomThemesResult {
    let themes_dir = get_themes_dir(&app);
    std::fs::create_dir_all(&themes_dir).ok();
    theme_loader::load_custom_themes(&themes_dir)
}

#[tauri::command]
pub fn get_theme_directory_info(app: tauri::AppHandle) -> ThemeDirectoryInfo {
    let themes_dir = get_themes_dir(&app);
    std::fs::create_dir_all(&themes_dir).ok();
    ThemeDirectoryInfo {
        themes_dir: themes_dir.to_string_lossy().to_string(),
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

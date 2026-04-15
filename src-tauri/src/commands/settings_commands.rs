use crate::db::Database;
use crate::extensions::theme_loader;
use crate::models::CustomThemesResult;
use crate::services::settings_service;
use std::path::PathBuf;
use tauri::{Manager, State};

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
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let themes_dir = app_dir.join("themes");
    std::fs::create_dir_all(&themes_dir).ok();
    theme_loader::load_custom_themes(&themes_dir)
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

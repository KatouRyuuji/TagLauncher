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
    crate::db::ensure_writes_allowed()?;
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

/// 通用 KV 命令的敏感前缀：ai.*/sync.* 凭据有专属脱敏通道（ai_get_config /
/// sync_get_config 均不下发明文），通用原语不得成为绕过脱敏的旁路（纵深防御）。
/// 前端当前仅用本命令读写 theme 等非敏感键，收紧不影响既有功能。
fn is_sensitive_setting_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.starts_with("ai.") || key.starts_with("sync.")
}

/// 完整性键：schema_version / app_version / migration::* 由迁移框架维护，
/// enabled_mods 由 enable_mod/disable_mod/delete_mod 专属通道维护（含损坏保护逻辑），
/// last_known_version 由 check_version_migration 专属通道原子维护（防 Mod 篡改
/// 触发假迁移弹窗）。放任通用 set_setting 写入会破坏迁移判定与 mod 启用状态的一致性，必须拦截。
fn is_integrity_setting_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key == "schema_version"
        || key == "app_version"
        || key == "enabled_mods"
        || key == "last_known_version"
        || key.starts_with("migration::")
}

#[tauri::command]
pub fn get_setting(db: State<Database>, key: String) -> Option<String> {
    // 敏感键按"不存在"处理：既不泄露值，也不泄露存在性
    if is_sensitive_setting_key(&key) {
        return None;
    }
    let conn = db.get_conn();
    settings_service::get_setting(&conn, &key)
}

#[tauri::command]
pub fn set_setting(db: State<Database>, key: String, value: String) -> Result<(), String> {
    crate::db::ensure_writes_allowed()?;
    if is_sensitive_setting_key(&key) {
        return Err("该配置项受保护，请使用对应的专用设置入口".to_string());
    }
    if is_integrity_setting_key(&key) {
        return Err("该配置项由系统维护，不允许通过通用入口修改".to_string());
    }
    let conn = db.get_conn();
    settings_service::set_setting(&conn, &key, &value)
}

/// 启动版本迁移检查（原子）：读 last_known_version → 与当前版本比较 → 写入当前版本，
/// 单次 IPC 完成，替代前端"读-比-写"三步调用（三步并发/中途失败会留下错误状态）。
/// 返回 Some 表示需要展示迁移对话框。
/// last_known_version 属完整性键（见 is_integrity_setting_key），只能经本通道维护。
#[tauri::command]
pub fn check_version_migration(db: State<Database>) -> Option<VersionMigration> {
    let current = settings_service::get_app_version();
    let conn = db.get_conn();
    let stored = settings_service::get_setting(&conn, "last_known_version");
    let show = stored.as_deref().map(|s| s != current).unwrap_or(false);
    // 无论是否展示都收敛记录到当前版本（与原前端三步逻辑一致；
    // 静默忽略写失败，容忍首次启动等异常场景）
    let _ = settings_service::set_setting(&conn, "last_known_version", current);
    if show {
        Some(VersionMigration {
            from_version: stored.unwrap_or_default(),
            to_version: current.to_string(),
        })
    } else {
        None
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionMigration {
    pub from_version: String,
    pub to_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_prefixes_are_blocked() {
        assert!(is_sensitive_setting_key("ai.api_key"));
        assert!(is_sensitive_setting_key("ai.base_url"));
        assert!(is_sensitive_setting_key("sync.password"));
        assert!(is_sensitive_setting_key("sync.webdav_url"));
        assert!(!is_sensitive_setting_key("last_known_version"));
        assert!(!is_sensitive_setting_key("theme"));
        assert!(!is_sensitive_setting_key("enabled_mods"));
        assert!(is_sensitive_setting_key("AI.api_key"));
        assert!(is_sensitive_setting_key("SYNC.password"));
    }

    #[test]
    fn integrity_keys_are_blocked() {
        assert!(is_integrity_setting_key("schema_version"));
        assert!(is_integrity_setting_key("app_version"));
        assert!(is_integrity_setting_key("enabled_mods"));
        assert!(is_integrity_setting_key("last_known_version"));
        assert!(is_integrity_setting_key("migration::8::description"));
        assert!(is_integrity_setting_key("migration::8::is_breaking"));
        assert!(is_integrity_setting_key("SCHEMA_VERSION"));
        assert!(is_integrity_setting_key("Enabled_Mods"));
        // 普通业务键不受影响
        assert!(!is_integrity_setting_key("theme"));
        assert!(!is_integrity_setting_key("migration_notes"));
    }
}

mod commands;
mod db;
mod extensions;
mod models;
mod services;

pub use commands::*;
pub use db::Database;

use extensions::mod_loader;
use extensions::mod_registry::ModRegistry;
use services::settings_service;
use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&app_dir).ok();

            // 初始化数据库
            let db_path = app_dir.join("taglauncher.db");
            let database = Database::new(&db_path).expect("Failed to initialize database");

            // 初始化 Mod 注册表
            let registry = ModRegistry::new();
            let mods_dir = app_dir.join("mods");
            std::fs::create_dir_all(&mods_dir).ok();

            let (enabled_mods, enabled_mods_err) = {
                let conn = database.get_conn();
                settings_service::get_enabled_mods(&conn)
            };

            // enabled_mods 解析失败时记录错误，防止误禁所有 mod
            if let Some(err) = enabled_mods_err {
                registry.add_load_error("系统".to_string(), err);
            }

            let app_version = settings_service::get_app_version();
            let (mods, mod_errors) = mod_loader::discover_mods(&mods_dir);

            // 记录 manifest 解析失败的错误
            for err in mod_errors {
                registry.add_load_error(err.dir_name, err.error);
            }

            for (manifest, path) in mods {
                let enabled = enabled_mods.contains(&manifest.id);

                // 校验 min_app_version 和 max_app_version
                let (is_compatible, incompatible_reason) = {
                    // 1. 检查最低版本要求
                    let min_ok = match manifest.min_app_version.as_deref() {
                        None => Ok(()),
                        Some(required) => {
                            if mod_loader::semver_gte(app_version, required) {
                                Ok(())
                            } else {
                                Err(format!(
                                    "需要 App >= {}，当前版本为 {}",
                                    required, app_version
                                ))
                            }
                        }
                    };
                    // 2. 检查最高版本限制（app_version > max → 不兼容）
                    let max_ok = match manifest.max_app_version.as_deref() {
                        None => Ok(()),
                        Some(max) => {
                            if mod_loader::semver_gte(max, app_version) {
                                Ok(())
                            } else {
                                Err(format!(
                                    "此 mod 不兼容 App >= {}，当前版本为 {}",
                                    max, app_version
                                ))
                            }
                        }
                    };
                    match (min_ok, max_ok) {
                        (Ok(()), Ok(())) => (true, None),
                        (Err(e), _) => (false, Some(e)),
                        (_, Err(e)) => (false, Some(e)),
                    }
                };

                registry.register(manifest, path, enabled, is_compatible, incompatible_reason);
            }

            app.manage(database);
            app.manage(registry);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 项目 CRUD
            add_item,
            remove_item,
            update_item_icon,
            get_items,
            // 标签管理
            get_tags,
            add_tag,
            update_tag,
            remove_tag,
            set_item_tags,
            // 搜索
            search_items,
            // 启动/打开
            launch_item,
            open_in_explorer,
            // 收藏
            toggle_favorite,
            // 文件柜
            get_cabinets,
            add_cabinet,
            update_cabinet,
            remove_cabinet,
            add_item_to_cabinet,
            remove_item_from_cabinet,
            get_cabinet_items,
            // 同义词
            read_synonyms,
            // 设置
            get_app_version,
            get_current_theme,
            set_current_theme,
            get_setting,
            set_setting,
            get_custom_themes,
            get_theme_directory_info,
            install_theme_file,
            export_theme_file,
            // Mod
            get_mods,
            get_mod_load_errors,
            get_mod_content,
            enable_mod,
            disable_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

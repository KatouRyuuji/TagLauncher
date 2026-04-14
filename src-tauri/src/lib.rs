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

            let enabled_mods = {
                let conn = database.get_conn();
                settings_service::get_enabled_mods(&conn)
            };

            for (manifest, path) in mod_loader::discover_mods(&mods_dir) {
                let enabled = enabled_mods.contains(&manifest.id);
                registry.register(manifest, path, enabled);
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
            // Mod
            get_mods,
            get_mod_content,
            enable_mod,
            disable_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

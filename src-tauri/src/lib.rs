// ============================================================================
// lib.rs — Tauri 应用初始化与配置
// ============================================================================
// 这是 Tauri 应用的核心配置文件，负责：
// 1. 注册插件（shell、dialog）
// 2. 初始化数据库并注入状态
// 3. 注册所有前端可调用的命令
// ============================================================================

mod commands;
mod db;

pub use commands::*;
pub use db::Database;

use std::path::PathBuf;
use tauri::Manager;

/// 应用启动入口（由 main.rs 调用）
///
/// # 初始化流程
/// 1. 注册 shell 插件（允许前端调用系统 shell 命令）
/// 2. 注册 dialog 插件（允许前端弹出原生文件选择对话框）
/// 3. setup 阶段：
///    a. 获取应用数据目录（Windows: %APPDATA%/com.taglauncher.app/）
///    b. 创建目录（如果不存在）
///    c. 在该目录下初始化 SQLite 数据库
///    d. 将数据库实例注入 Tauri 状态管理（命令函数通过 State<Database> 获取）
/// 4. 注册所有 Tauri 命令（前端通过 invoke("命令名") 调用）
/// 5. 启动应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 获取应用数据目录，失败时回退到当前目录
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&app_dir).ok();

            // 初始化 SQLite 数据库
            let db_path = app_dir.join("taglauncher.db");
            let database = Database::new(&db_path).expect("Failed to initialize database");

            // 注入状态：命令函数通过 State<Database> 参数自动获取此实例
            app.manage(database);
            Ok(())
        })
        // generate_handler! 宏为每个命令函数生成 IPC 路由
        // 前端调用 invoke("add_item", { path: "..." }) 时，
        // Tauri 会自动找到对应的 Rust 函数并调用
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

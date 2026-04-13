// ============================================================================
// main.rs — 应用程序入口
// ============================================================================
// 在 release 模式下隐藏 Windows 控制台窗口（debug 模式保留，方便查看日志）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 调用 lib.rs 中定义的 run() 函数启动 Tauri 应用
    tag_launcher_lib::run()
}

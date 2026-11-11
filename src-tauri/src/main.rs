// ============================================================================
// main.rs — 应用程序入口
// ============================================================================
// 在 release 模式下隐藏 Windows 控制台窗口（debug 模式保留，方便查看日志）。
// `gui-subsystem` 特性让 debug 构建也用 GUI 子系统：E2E desktop 作业用它，资源管理器 / ShellExecute
// 启动的每个转发进程才不会各建一个控制台（conhost），延迟与发布版同口径。
#![cfg_attr(any(not(debug_assertions), feature = "gui-subsystem"), windows_subsystem = "windows")]

fn main() {
    // 调用 lib.rs 中定义的 run() 函数启动 Tauri 应用
    tag_launcher_lib::run()
}

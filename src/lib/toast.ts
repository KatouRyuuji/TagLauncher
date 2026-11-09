// ============================================================================
// lib/toast.ts — 全局 Toast 单一入口
// ============================================================================
// 通过派发 "taglauncher-toast" CustomEvent 通知 ToastContainer 统一渲染。
// 全应用统一从此处 import { showToast }，避免各处重复内联同一份实现（DRY）。
// mod JS 侧也可通过 window.__tagLauncherModApi.notify() 触发同一事件。
// ============================================================================

export type ToastType = "info" | "success" | "error" | "warning";

/**
 * 去掉 db.invokeCmd 为定位而加的内部命令名前缀（如「[backup_data] 」）。
 * 前缀对日志有用，但对用户是噪音；只匹配位于开头或「：」之后、snake_case / plugin:x|y 形式的命令 id。
 */
export function stripCommandPrefix(message: string): string {
  return message.replace(/(^|：|: )\[(?:plugin:[a-z0-9_-]+\|)?[a-z][a-z0-9_]*\] /g, "$1");
}

/** 弹出全局 toast 通知（默认 info）。 */
export function showToast(message: string, type: ToastType = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", { detail: { message: stripCommandPrefix(message), type } }),
  );
}

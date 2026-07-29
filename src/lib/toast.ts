// ============================================================================
// lib/toast.ts — 全局 Toast 单一入口
// ============================================================================
// 通过派发 "taglauncher-toast" CustomEvent 通知 ToastContainer 统一渲染。
// 全应用统一从此处 import { showToast }，避免各处重复内联同一份实现（DRY）。
// mod JS 侧也可通过 window.__tagLauncherModApi.notify() 触发同一事件。
// ============================================================================

export type ToastType = "info" | "success" | "error" | "warning";

/** 弹出全局 toast 通知（默认 info）。 */
export function showToast(message: string, type: ToastType = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", { detail: { message, type } }),
  );
}

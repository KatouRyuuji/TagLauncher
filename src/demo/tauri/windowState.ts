// ============================================================================
// demo/tauri/windowState.ts — @tauri-apps/plugin-window-state 的 demo 替身
// ============================================================================
// 浏览器里没有可恢复的窗口状态，恢复调用直接返回。
// ============================================================================

export enum StateFlags {
  SIZE = 1,
  POSITION = 2,
  MAXIMIZED = 4,
  VISIBLE = 8,
  DECORATIONS = 16,
  FULLSCREEN = 32,
  ALL = 63,
}

export async function restoreStateCurrent(): Promise<void> {}

// ============================================================================
// lib/colorMode.ts — 亮色/暗色模式偏好（独立于主题的开关）
// ----------------------------------------------------------------------------
// 模型：主题 = 配色家族（霜靛/藤色/…），模式 = 亮色/暗色/跟随系统。
// 偏好持久化在 localStorage（与视图偏好同款思路）；内置主题家族按模式解析到
// 具体主题 id（见 themes/index.ts 的 THEME_FAMILIES），自定义/Mod 主题自带
// 配色方案，不随模式切换。
// ============================================================================

export type ColorMode = "light" | "dark" | "system";
/** 解析后的实际生效模式（system 已按系统偏好求值） */
export type ResolvedColorMode = "light" | "dark";

export const COLOR_MODE_KEY = "taglauncher.color-mode";
/** 模式切换后派发，useTheme 监听以按最新模式重解析当前主题 */
export const COLOR_MODE_CHANGED_EVENT = "taglauncher:color-mode-changed";

export function getColorMode(): ColorMode {
  try {
    const raw = localStorage.getItem(COLOR_MODE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

export function setColorMode(mode: ColorMode): void {
  try {
    localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    // 隐私模式等场景写入失败时退化为会话内生效（事件仍会派发）
  }
}

export function resolveSystemMode(): ResolvedColorMode {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveColorMode(mode: ColorMode): ResolvedColorMode {
  return mode === "system" ? resolveSystemMode() : mode;
}

/** 监听系统亮暗变化（仅当偏好为 system 时调用方需要关心）。返回解绑函数。 */
export function onSystemColorModeChange(callback: (mode: ResolvedColorMode) => void): () => void {
  try {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => callback(media.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  } catch {
    return () => {};
  }
}

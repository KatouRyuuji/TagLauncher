// ============================================================================
// lib/modApi.ts — 暴露给 JS Mod 的全局 API
// ============================================================================
// 通过 window.__tagLauncherModApi 访问。
//
// JS mod 可以使用的能力：
//   - 读写 CSS 变量（主题系统集成）
//   - 监听主题切换事件
//   - 订阅应用事件（搜索输入、项目启动）
//   - 获取当前可见的项目列表（只读快照）
// ============================================================================

interface TagLauncherModApi {
  /** API 版本号，供 mod 做兼容性判断 */
  version: string;

  // ── 主题 ──────────────────────────────────────────────────────────────

  /** 读取当前主题的 CSS 变量值 */
  getThemeVariable(name: string): string;

  /** 覆盖单个 CSS 变量（仅对当前会话生效，切换主题后会被重置） */
  setThemeVariable(name: string, value: string): void;

  /** 获取当前主题 ID（如 "dark" / "sakura"） */
  getThemeId(): string;

  /** 监听主题切换，返回取消订阅函数 */
  onThemeChange(callback: (themeId: string) => void): () => void;

  // ── 应用事件 ────────────────────────────────────────────────────────

  /** 监听搜索框输入变化，返回取消订阅函数 */
  onSearchInput(callback: (query: string) => void): () => void;

  /** 监听项目被启动，返回取消订阅函数 */
  onItemLaunched(callback: (itemId: number, itemName: string) => void): () => void;
}

// ── 内部监听器集合 ────────────────────────────────────────────────────────

const themeChangeListeners = new Set<(themeId: string) => void>();
const searchInputListeners = new Set<(query: string) => void>();
const itemLaunchedListeners = new Set<(itemId: number, itemName: string) => void>();

// ── 公共通知函数（由应用内部调用）────────────────────────────────────────

export function notifyThemeChange(themeId: string) {
  for (const cb of themeChangeListeners) {
    try { cb(themeId); } catch { /* ignore mod errors */ }
  }
}

export function notifySearchInput(query: string) {
  for (const cb of searchInputListeners) {
    try { cb(query); } catch { /* ignore */ }
  }
}

export function notifyItemLaunched(itemId: number, itemName: string) {
  for (const cb of itemLaunchedListeners) {
    try { cb(itemId, itemName); } catch { /* ignore */ }
  }
}

// ── API 实现 ──────────────────────────────────────────────────────────────

export const modApi: TagLauncherModApi = {
  version: "1.1.0",

  getThemeVariable(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  },

  setThemeVariable(name: string, value: string): void {
    document.documentElement.style.setProperty(`--${name}`, value);
  },

  getThemeId(): string {
    return document.documentElement.getAttribute("data-theme-id") ?? "";
  },

  onThemeChange(callback) {
    themeChangeListeners.add(callback);
    return () => { themeChangeListeners.delete(callback); };
  },

  onSearchInput(callback) {
    searchInputListeners.add(callback);
    return () => { searchInputListeners.delete(callback); };
  },

  onItemLaunched(callback) {
    itemLaunchedListeners.add(callback);
    return () => { itemLaunchedListeners.delete(callback); };
  },
};

// ── 初始化（挂载到 window）────────────────────────────────────────────────

export function initModApi() {
  (window as unknown as Record<string, unknown>).__tagLauncherModApi = modApi;
}

// ============================================================================
// lib/modRuntime.ts — Mod 运行时：CSS / JS / Theme 注入与清理
// ============================================================================
// 职责：
//   - CSS mod  → 注入/移除 <style id="__mod-css-{id}"> 标签
//   - JS  mod  → 执行 <script>；禁用时调用 window.__modCleanup_{id}() 钩子
//   - Theme mod → 解析 JSON，通过 DOM 事件通知 useTheme 动态增删可选主题
//
// 设计原则：
//   - 与 React 解耦（纯 DOM 操作），任意时刻均可调用
//   - 每个 mod 的 DOM 元素以 mod ID 命名，便于调试和清理
//   - JS mod 的"卸载"依赖 mod 自身注册的 __modCleanup_{id} 函数；
//     若不存在则仅移除 <script> 元素（已执行的代码无法撤销）
// ============================================================================

import type { ModInfo } from "../types/mod";
import type { ThemeDefinition } from "../types/theme";
import * as db from "./db";
import { MOD_THEME_ADDED, MOD_THEME_REMOVED } from "../hooks/useTheme";

// ── 工具函数 ──────────────────────────────────────────────────────────────

function cssTagId(modId: string) {
  return `__mod-css-${modId}`;
}

function jsTagId(modId: string) {
  return `__mod-js-${modId}`;
}

// ── CSS mod ───────────────────────────────────────────────────────────────

function injectCss(modId: string, cssContent: string) {
  let el = document.getElementById(cssTagId(modId)) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = cssTagId(modId);
    document.head.appendChild(el);
  }
  el.textContent = cssContent;
}

function removeCss(modId: string) {
  document.getElementById(cssTagId(modId))?.remove();
}

// ── JS mod ────────────────────────────────────────────────────────────────

function executeJs(modId: string, jsContent: string) {
  // 先清理同 ID 的旧 script（防止重复执行）
  removeJs(modId);
  const script = document.createElement("script");
  script.id = jsTagId(modId);
  // 注入 __MOD_ID__ 常量，供 mod 调用 createScope(__MOD_ID__) 获取专属作用域
  script.textContent = `(function(){const __MOD_ID__=${JSON.stringify(modId)};\n${jsContent}\n})();`;
  document.head.appendChild(script);
}

function removeJs(modId: string) {
  // 1. 调用 mod 自身注册的清理钩子（如果有）
  const cleanupKey = `__modCleanup_${modId.replace(/-/g, "_")}`;
  try {
    const w = window as unknown as Record<string, unknown>;
    const cleanup = w[cleanupKey];
    if (typeof cleanup === "function") {
      (cleanup as () => void)();
    }
  } catch {
    // 钩子抛出异常时静默忽略
  }
  // 2. 移除 script 标签
  document.getElementById(jsTagId(modId))?.remove();
}

// ── Theme mod ─────────────────────────────────────────────────────────────

function dispatchThemeAdded(theme: ThemeDefinition) {
  window.dispatchEvent(new CustomEvent<ThemeDefinition>(MOD_THEME_ADDED, { detail: theme }));
}

function dispatchThemeRemoved(themeId: string) {
  window.dispatchEvent(new CustomEvent<string>(MOD_THEME_REMOVED, { detail: themeId }));
}

// 解析 mod 提供的主题 JSON 内容
// 强制覆盖 id 为 mod-theme-${modId}，确保增删事件的 key 始终一致
function parseModTheme(modId: string, jsonContent: string): ThemeDefinition | null {
  try {
    const parsed = JSON.parse(jsonContent) as ThemeDefinition;
    parsed.id = `mod-theme-${modId}`;
    return parsed;
  } catch {
    console.warn(`[modRuntime] Failed to parse theme JSON for mod "${modId}"`);
    return null;
  }
}

// ── 主接口 ────────────────────────────────────────────────────────────────

/** 启用单个 mod：读取入口文件，按类型注入 */
export async function enableModRuntime(mod: ModInfo): Promise<void> {
  const { id, type, entrypoints } = mod;

  try {
    if (type === "css" || type === "css+js") {
      if (entrypoints.css) {
        const css = await db.getModContent(id, entrypoints.css);
        injectCss(id, css);
      }
    }

    if (type === "css+js") {
      if (entrypoints.js) {
        const js = await db.getModContent(id, entrypoints.js);
        executeJs(id, js);
      }
    }

    if (type === "theme") {
      if (entrypoints.theme) {
        const json = await db.getModContent(id, entrypoints.theme);
        const theme = parseModTheme(id, json);
        if (theme) dispatchThemeAdded(theme);
      }
    }
  } catch (err) {
    console.error(`[modRuntime] Failed to enable mod "${id}":`, err);
  }
}

/** 禁用单个 mod：移除注入的 CSS/JS，通知主题删除 */
export function disableModRuntime(mod: ModInfo): void {
  const { id, type, entrypoints } = mod;

  if (type === "css" || type === "css+js") {
    if (entrypoints.css) removeCss(id);
  }

  if (type === "css+js") {
    if (entrypoints.js) removeJs(id);
  }

  if (type === "theme") {
    // 通知 useTheme 从列表中移除
    const themeId = `mod-theme-${id}`;
    dispatchThemeRemoved(themeId);
  }
}

/** 应用启动时：批量注入所有已启用的 mod */
export async function initModRuntime(mods: ModInfo[]): Promise<void> {
  const enabled = mods.filter((m) => m.enabled);
  await Promise.allSettled(enabled.map(enableModRuntime));
}

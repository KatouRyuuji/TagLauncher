// ============================================================================
// lib/modRuntime.ts — Mod 运行时：CSS / JS / Theme 注入与清理
// ============================================================================
// 职责：
//   - CSS mod  → 注入/移除 <style id="__mod-css-{id}"> 标签
//   - JS  mod  → 执行 <script>；禁用时调用清理钩子
//   - Theme mod → 解析 JSON，通过 DOM 事件通知 useTheme 动态增删可选主题
//
// 设计原则：
//   - 与 React 解耦（纯 DOM 操作），任意时刻均可调用
//   - 每个 mod 的 DOM 元素以 mod ID 命名，便于调试和清理
//   - JS mod 应通过 api.onDisable() 注册清理函数；
//     未注册时 notify 警告用户可能需要刷新
// ============================================================================

import type { ModInfo } from "../types/mod";
import type { ThemeDefinition } from "../types/theme";
import * as db from "./db";
import { MOD_THEME_ADDED, MOD_THEME_REMOVED } from "../hooks/useTheme";
import {
  registerModPermissions,
  registerModApiVersion,
  callModCleanup,
} from "./modApi";

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

async function removeJs(modId: string) {
  // 调用 api.onDisable() 注册的清理回调，支持异步 + 500ms 超时
  const hadCleanup = await callModCleanup(modId);
  if (!hadCleanup) {
    // 未注册清理函数：警告用户
    notifyNoCleanup(modId);
  }

  // 移除 script 标签
  document.getElementById(jsTagId(modId))?.remove();
}

function notifyNoCleanup(modId: string) {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", {
      detail: {
        message: `Mod "${modId}" 未注册清理函数，定时器/监听器可能仍在运行。建议刷新应用。`,
        type: "warning",
      },
    }),
  );
}

// ── Theme mod ─────────────────────────────────────────────────────────────

/** modId → 实际注册的 themeId（用于禁用时精确移除） */
const modThemeIdMap = new Map<string, string>();

function dispatchThemeAdded(theme: ThemeDefinition) {
  window.dispatchEvent(new CustomEvent<ThemeDefinition>(MOD_THEME_ADDED, { detail: theme }));
}

function dispatchThemeRemoved(themeId: string) {
  window.dispatchEvent(new CustomEvent<string>(MOD_THEME_REMOVED, { detail: themeId }));
}

/**
 * 解析 mod 提供的主题 JSON。
 * 保留 JSON 中声明的 id；若未声明则默认为 mod-theme-${modId}。
 */
function parseModTheme(modId: string, jsonContent: string): ThemeDefinition | null {
  try {
    const parsed = JSON.parse(jsonContent) as ThemeDefinition;
    if (!parsed.id || parsed.id.trim() === "") {
      parsed.id = `mod-theme-${modId}`;
    }
    return parsed;
  } catch {
    console.warn(`[modRuntime] Failed to parse theme JSON for mod "${modId}"`);
    return null;
  }
}

// ── 主接口 ────────────────────────────────────────────────────────────────

/** 启用单个 mod：注册元信息，读取入口文件，按类型注入 */
export async function enableModRuntime(mod: ModInfo): Promise<void> {
  const { id, type, entrypoints } = mod;

  // 注册权限声明和 API 版本（在执行 JS 之前完成，确保 createScope 能正确检查）
  // undefined = 旧 mod 未声明 permissions → 不限制；[] = 显式声明无权限
  registerModPermissions(id, mod.permissions as import("../types/mod").ModPermission[] | undefined);
  registerModApiVersion(id, mod.api_version);

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
        if (theme) {
          modThemeIdMap.set(id, theme.id);
          dispatchThemeAdded(theme);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[modRuntime] Failed to enable mod "${id}":`, err);
    window.dispatchEvent(
      new CustomEvent("taglauncher-toast", {
        detail: { message: `Mod "${mod.name}" 加载失败：${msg}`, type: "error" },
      }),
    );
  }
}

/** 禁用单个 mod：移除注入的 CSS/JS（等待异步清理），通知主题删除 */
export async function disableModRuntime(mod: ModInfo): Promise<void> {
  const { id, type, entrypoints } = mod;

  if (type === "css" || type === "css+js") {
    if (entrypoints.css) removeCss(id);
  }

  if (type === "css+js") {
    if (entrypoints.js) await removeJs(id);
  }

  if (type === "theme") {
    // 使用注册时记录的实际 themeId（保留了 mod JSON 中的原始 id）
    const themeId = modThemeIdMap.get(id) ?? `mod-theme-${id}`;
    modThemeIdMap.delete(id);
    dispatchThemeRemoved(themeId);
  }
}

/** 热重载单个 mod（等待清理完成后再重新启用） */
export async function reloadModRuntime(mod: ModInfo): Promise<void> {
  await disableModRuntime(mod);
  await enableModRuntime(mod);
}

/** 应用启动时：批量注入所有已启用的 mod */
export async function initModRuntime(mods: ModInfo[]): Promise<void> {
  const enabled = mods.filter((m) => m.enabled);
  await Promise.allSettled(enabled.map(enableModRuntime));
}

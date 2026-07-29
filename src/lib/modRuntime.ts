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
  callModLifecycle,
  trackModStart,
  purgeModResources,
  setExecutingModId,
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
    el.setAttribute("data-mod-css", modId);
    document.head.appendChild(el);
  }
  // 自动包裹 @layer，降低 mod CSS 优先级，避免意外覆盖应用核心样式
  const safeId = modId.replace(/[^a-zA-Z0-9_-]/g, "-");
  el.textContent = `@layer mod-${safeId} {\n${cssContent}\n}`;
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
  // 绑定当前执行 mod：内联 script 在 appendChild 时同步执行其顶层代码，
  // 期间 mod 通常调用 createScope(__MOD_ID__)，据此校验其不冒用他人 id。
  // 执行结束（同步）后立即清除；异步回调阶段无法归因，createScope 仅校验注册。
  setExecutingModId(modId);
  try {
    document.head.appendChild(script);
  } finally {
    setExecutingModId(null);
  }
}

function removeJs(modId: string) {
  // 移除 script 标签（清理回调和状态追踪由 purgeModResources 统一处理）
  document.getElementById(jsTagId(modId))?.remove();
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

/** 内置保留主题 id（与后端 theme_loader::RESERVED_THEME_IDS 同步，禁止 mod 主题占用） */
const RESERVED_THEME_IDS = ["dark", "light", "sakura"];

/**
 * 校验 mod 主题结构（与后端 theme_loader::validate_theme_for_loading 同款口径）。
 * 通过返回 null，不通过返回错误描述字符串。
 */
function validateModTheme(theme: ThemeDefinition): string | null {
  if (!theme.id || theme.id.trim() === "") return "缺少主题 id";
  if (!theme.name || theme.name.trim() === "") return "缺少主题 name";
  if (RESERVED_THEME_IDS.includes(theme.id)) return `主题 id "${theme.id}" 与内置主题冲突`;
  const variables = theme.variables;
  if (!variables || typeof variables !== "object" || Object.keys(variables).length === 0) {
    return "缺少 variables 或 variables 为空";
  }
  const badKey = Object.keys(variables).find((k) => k.trim() === "" || k.startsWith("--"));
  if (badKey !== undefined) {
    return `变量名 "${badKey}" 无效（不能为空且不应包含 -- 前缀）`;
  }
  return null;
}

/**
 * 解析 mod 提供的主题 JSON，并做与后端一致的结构/保留 id 校验。
 * 保留 JSON 中声明的 id；若未声明则默认为 mod-theme-${modId}。
 * 解析或校验失败时提示用户并返回 null（不注册该主题）。
 */
function parseModTheme(modId: string, jsonContent: string): ThemeDefinition | null {
  let parsed: ThemeDefinition;
  try {
    parsed = JSON.parse(jsonContent) as ThemeDefinition;
  } catch {
    console.warn(`[modRuntime] Failed to parse theme JSON for mod "${modId}"`);
    window.dispatchEvent(
      new CustomEvent("taglauncher-toast", {
        detail: { message: `Mod "${modId}" 主题 JSON 解析失败`, type: "error" },
      }),
    );
    return null;
  }
  if (!parsed.id || parsed.id.trim() === "") {
    parsed.id = `mod-theme-${modId}`;
  }
  const error = validateModTheme(parsed);
  if (error) {
    console.warn(`[modRuntime] Mod "${modId}" 主题校验失败：${error}`);
    window.dispatchEvent(
      new CustomEvent("taglauncher-toast", {
        detail: { message: `Mod "${modId}" 主题校验失败：${error}`, type: "error" },
      }),
    );
    return null;
  }
  return parsed;
}

// ── 主接口 ────────────────────────────────────────────────────────────────

/** 模块级初始化标记：防止 StrictMode / 重复调用导致 mod 被加载两次 */
let initModRuntimePromise: Promise<void> | null = null;

/** 启用单个 mod：注册元信息，读取入口文件，按类型注入 */
export async function enableModRuntime(mod: ModInfo): Promise<void> {
  const { id, type, entrypoints } = mod;

  // 注册权限声明和 API 版本（在执行 JS 之前完成，确保 createScope 能正确检查）
  // undefined = 旧 mod 未声明 permissions → 不限制；[] = 显式声明无权限
  registerModPermissions(id, mod.permissions as import("../types/mod").ModPermission[] | undefined);
  registerModApiVersion(id, mod.api_version);

  // 初始化该 mod 的状态追踪（用于后续强制清理）
  trackModStart(id);

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
          // 注入主题包绝对根目录，供前端按 convertFileSrc 解析 assets/fonts 相对路径。
          // 取注册表中的真实目录（目录名可能与 id 不同），获取失败不阻断主题注册。
          try {
            theme.themeRoot = await db.getModDir(id);
          } catch {
            // 仅相对资源可能无法解析，主题其余部分仍可正常应用
          }
          modThemeIdMap.set(id, theme.id);
          dispatchThemeAdded(theme);
        }
      }
    }

    // 触发 onEnable 生命周期回调
    await callModLifecycle(id, "enable");

    // 检查安装状态，触发 install / update 生命周期
    await handleInstallLifecycle(mod);
  } catch (err) {
    // 启用中途失败：对称回滚已注入资源，避免部分加载状态
    await purgeModResources(id).catch(() => {});
    removeCss(id);
    removeJs(id);
    const themeId = modThemeIdMap.get(id);
    if (themeId) {
      modThemeIdMap.delete(id);
      dispatchThemeRemoved(themeId);
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[modRuntime] Failed to enable mod "${id}":`, err);
    window.dispatchEvent(
      new CustomEvent("taglauncher-toast", {
        detail: { message: `Mod "${mod.name}" 加载失败：${msg}`, type: "error" },
      }),
    );
    throw err;
  }
}

/**
 * 根据 mod 安装状态触发 install 或 update 生命周期回调。
 * 触发完成后立即标记版本，确保下次不再重复触发。
 */
async function handleInstallLifecycle(mod: ModInfo): Promise<void> {
  try {
    const state = await db.getModInstallState(mod.id);
    if (state === "new") {
      await callModLifecycle(mod.id, "install");
      await db.markModVersion(mod.id, mod.version);
    } else if (state.startsWith("updated:")) {
      await callModLifecycle(mod.id, "update");
      await db.markModVersion(mod.id, mod.version);
    }
    // "unchanged" 无需处理
  } catch (err) {
    console.warn(`[modRuntime] Failed to handle install lifecycle for "${mod.id}":`, err);
  }
}

/**
 * 禁用单个 mod：强制清理所有资源（CSS/JS/Panel/监听器/生命周期回调）。
 * @param skipClearLifecycle 为 true 时保留生命周期注册表（用于 uninstall 流程）
 */
export async function disableModRuntime(mod: ModInfo, skipClearLifecycle?: boolean): Promise<void> {
  const { id, type, entrypoints } = mod;

  // 1. 执行完整的资源清理（生命周期回调、监听器、Panel、权限注册表）
  await purgeModResources(id, skipClearLifecycle);

  // 2. 移除 DOM 注入
  if (type === "css" || type === "css+js") {
    if (entrypoints.css) removeCss(id);
  }
  if (type === "css+js") {
    if (entrypoints.js) removeJs(id);
  }

  // 3. 主题清理
  if (type === "theme") {
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

// ── 依赖管理与拓扑排序 ────────────────────────────────────────────────────

/**
 * 简单的语义版本匹配。
 * 支持的格式：
 *   "^1.0.0"  — 主版本相同，且不低于 1.0.0
 *   ">=1.0.0" — 不低于 1.0.0
 *   "1.0.0"   — 精确匹配
 *
 * 注意：须与后端 `mod_loader::semver_satisfies` 保持同款语义（二者算法一致）。
 * 未改用成熟 semver 库是受本轮改动文件范围约束（不新增 package.json/Cargo.toml 依赖）；
 * 若后续统一为库实现，请前后端一并替换。
 */
export function semverSatisfies(version: string, range: string): boolean {
  const parse = (s: string): number[] => s.split(".").map((p) => parseInt(p.split("-")[0], 10) || 0);
  const v = parse(version);
  // 与后端 mod_loader::semver_satisfies 一致：前缀判断用 trim 后的 range，
  // 精确匹配分支与后端同样比较原始字符串（含空白时两侧同样不匹配）。
  const trimmedRange = range.trim();
  const r = trimmedRange.replace(/^\^|^>=/, "");
  const rv = parse(r);

  if (trimmedRange.startsWith("^")) {
    if (v[0] !== rv[0]) return false;
    for (let i = 0; i < 3; i++) {
      if ((v[i] || 0) > (rv[i] || 0)) return true;
      if ((v[i] || 0) < (rv[i] || 0)) return false;
    }
    return true;
  }
  if (trimmedRange.startsWith(">=")) {
    for (let i = 0; i < 3; i++) {
      if ((v[i] || 0) > (rv[i] || 0)) return true;
      if ((v[i] || 0) < (rv[i] || 0)) return false;
    }
    return true;
  }
  return version === range;
}

/**
 * 检查单个 mod 的依赖是否满足。
 * 返回 { satisfied: true } 或 { satisfied: false, missing: [...], unsatisfied: [...] }
 */
export function checkDependencySatisfied(
  mod: ModInfo,
  allMods: ModInfo[],
): {
  satisfied: boolean;
  missing: string[];
  unsatisfied: Array<{ id: string; required: string; actual: string }>;
} {
  const modMap = new Map(allMods.map((m) => [m.id, m]));
  const missing: string[] = [];
  const unsatisfied: Array<{ id: string; required: string; actual: string }> = [];

  for (const [depId, requiredVersion] of Object.entries(mod.dependencies || {})) {
    const dep = modMap.get(depId);
    if (!dep || !dep.enabled) {
      missing.push(depId);
      continue;
    }
    if (!semverSatisfies(dep.version, requiredVersion)) {
      unsatisfied.push({ id: depId, required: requiredVersion, actual: dep.version });
    }
  }

  return { satisfied: missing.length === 0 && unsatisfied.length === 0, missing, unsatisfied };
}

/**
 * 对启用的 mod 进行拓扑排序（Kahn 算法）。
 * 同时考虑 dependencies 和 load_after 声明。
 * 循环依赖时，将剩余 mod 按原始顺序追加并返回循环警告列表。
 */
function topologicalSort(mods: ModInfo[]): { sorted: ModInfo[]; cycles: string[] } {
  const modMap = new Map(mods.map((m) => [m.id, m]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>(); // modId -> 依赖于它的 mods

  for (const mod of mods) {
    inDegree.set(mod.id, 0);
  }

  for (const mod of mods) {
    const deps = [
      ...Object.keys(mod.dependencies || {}),
      ...(mod.load_after || []),
    ];
    for (const depId of deps) {
      if (!modMap.has(depId)) continue; // 缺失的依赖跳过（由 checkDependencySatisfied 处理）
      inDegree.set(mod.id, (inDegree.get(mod.id) || 0) + 1);
      if (!adj.has(depId)) adj.set(depId, []);
      adj.get(depId)!.push(mod.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: ModInfo[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const mod = modMap.get(id);
    if (mod) sorted.push(mod);

    for (const dependent of adj.get(id) || []) {
      const newDeg = (inDegree.get(dependent) || 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  const cycles: string[] = [];
  if (sorted.length !== mods.length) {
    const seen = new Set(sorted.map((m) => m.id));
    for (const mod of mods) {
      if (!seen.has(mod.id)) {
        sorted.push(mod);
        cycles.push(mod.id);
      }
    }
  }

  return { sorted, cycles };
}

/** 应用启动时：按依赖拓扑顺序批量注入所有已启用的 mod（幂等：StrictMode 或重复调用只执行一次） */
export function initModRuntime(mods: ModInfo[]): Promise<void> {
  if (initModRuntimePromise) {
    return initModRuntimePromise;
  }
  initModRuntimePromise = (async () => {
    const enabled = mods.filter((mod) => mod.enabled);
    // 先校验依赖并过滤出可加载的 mod
    const validMods: ModInfo[] = [];
    for (const mod of enabled) {
      const check = checkDependencySatisfied(mod, enabled);
      if (check.satisfied) {
        validMods.push(mod);
      } else {
        const reasons: string[] = [];
        if (check.missing.length) reasons.push(`缺少依赖：${check.missing.join(", ")}`);
        for (const u of check.unsatisfied) {
          reasons.push(`依赖 "${u.id}" 版本不满足（需要 ${u.required}，实际 ${u.actual}）`);
        }
        console.warn(`[modRuntime] Mod "${mod.id}" 依赖未满足，跳过加载：${reasons.join("；")}`);
        window.dispatchEvent(
          new CustomEvent("taglauncher-toast", {
            detail: {
              message: `Mod "${mod.name}" 依赖未满足，已跳过加载：${reasons.join("；")}`,
              type: "warning",
            },
          }),
        );
      }
    }

    const { sorted, cycles } = topologicalSort(validMods);

    if (cycles.length > 0) {
      console.warn(`[modRuntime] 检测到循环依赖，受影响 mod：${cycles.join(", ")}`);
      window.dispatchEvent(
        new CustomEvent("taglauncher-toast", {
          detail: {
            message: `检测到 Mod 循环依赖：${cycles.join(", ")}，加载顺序可能不正确`,
            type: "warning",
          },
        }),
      );
    }

    // 按拓扑顺序串行加载（保证依赖先初始化完毕）
    for (const mod of sorted) {
      try {
        await enableModRuntime(mod);
      } catch (err) {
        console.error(`[modRuntime] Failed to enable mod "${mod.id}" during init:`, err);
      }
    }
  })();
  return initModRuntimePromise;
}

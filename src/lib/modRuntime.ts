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
//   - JS mod 应通过 api.onLifecycle("disable", cb) 注册清理函数；
//     未注册时的「可能残留副作用，建议刷新」警告由 useMods 的禁用流程负责
//     （本模块只负责注入与强制清理，不弹该警告）
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
  isModRuntimeActive,
  purgeModResources,
  setExecutingModId,
} from "./modApi";
import { showToast } from "./toast";

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

/** 内置保留主题 id（与后端 theme_loader::RESERVED_THEME_IDS 同步，禁止 mod 主题占用）。
 *  组成：14 套内置主题的 uuid + 迁移仍会改写的全部停用字符串 id（v008/v009/v010 的
 *  输入 id）——mod 主题占用这些 id 会与内置主题或持久化配置的迁移映射产生歧义。 */
const RESERVED_THEME_IDS = [
  // 在架内置主题 uuid（src/themes/ryuuji.ts DEFS 与 sakura.ts）
  "7f47aab2-74bb-4c77-b99b-550f0acf3c9c",
  "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93",
  "668e5856-9d9f-481a-8f82-325372d2e256",
  "65596bf6-3aaf-4322-93f2-bbb60cb94b5d",
  "3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2",
  "cd4665e5-081f-434b-943f-bd44b49cd6ac",
  "6794e521-fd01-4e6d-997a-c4d0f1c66de2",
  "f2368e2a-ee19-4192-96ea-3db85f15c74d",
  "70492696-751c-4a29-9ab4-09ad8ddff1a4",
  "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a",
  "e0f5add7-8b67-42c9-9b2b-c7bbf49e255d",
  "6c309a70-ec6a-4429-8299-c4cde7c0ffcc",
  "5298ac16-455f-42f8-8bc8-e9b03ee0fdbf",
  "cfaadcb4-7e85-460c-a8fe-52e848959719",
  // 迁移仍会改写的停用字符串 id
  "sakura",
  "light",
  "dark",
  "cyber-cyan",
  "ryuuji-a1-dark",
  "ryuuji-a2-light",
  "ryuuji-a3-light",
  "ryuuji-a3-dark",
  "ryuuji-a4-light",
  "ryuuji-a4-dark",
  "ryuuji-a5-light",
  "ryuuji-a5-dark",
  "ryuuji-a6-light",
  "ryuuji-a6-dark",
  "ryuuji-b1-light",
  "ryuuji-b1-dark",
  "ryuuji-b2-light",
  "ryuuji-b3-light",
  "ryuuji-b3-dark",
  "ryuuji-b4-light",
  "ryuuji-b4-dark",
];

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
    showToast(`Mod "${modId}" 主题 JSON 解析失败`, "error");
    return null;
  }
  if (!parsed.id || parsed.id.trim() === "") {
    parsed.id = `mod-theme-${modId}`;
  }
  const error = validateModTheme(parsed);
  if (error) {
    console.warn(`[modRuntime] Mod "${modId}" 主题校验失败：${error}`);
    showToast(`Mod "${modId}" 主题校验失败：${error}`, "error");
    return null;
  }
  return parsed;
}

// ── 主接口 ────────────────────────────────────────────────────────────────

/** 模块级初始化标记：防止 StrictMode / 重复调用导致 mod 被加载两次 */
let initModRuntimePromise: Promise<void> | null = null;

/**
 * 单 mod 操作互斥队列：同一 mod 的 enable/disable/reload 必须串行。
 * 后到操作挂在前一个操作之后「等待执行」（不拒绝，保留用户最后一次操作意图）：
 *   - 交错 A（disable 慢钩子窗口内 enable）：enable 等 purge 完成后再注入，
 *     避免新注入的资源被前序 purge 掏空；
 *   - 交错 B（enable 的 IPC await 窗口内 disable）：disable 等注入完成后统一清理，
 *     用户的禁用意图不被吞掉（CSS 不残留、启用结果不被反转）；
 *   - initModRuntime 启动串行加载与用户手动操作经同一队列互斥。
 * 前序操作失败不阻断队列（错误经各自返回的 Promise 抛给调用方处理）。
 */
const modOpQueue = new Map<string, Promise<void>>();

function enqueueModOp(modId: string, op: () => Promise<void>): Promise<void> {
  const prev = modOpQueue.get(modId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(op);
  // 尾指针吞掉 rejection 仅用于排队与自清理；真实错误经 run 抛给调用方
  const tail = run.catch(() => {});
  modOpQueue.set(modId, tail);
  void tail.then(() => {
    if (modOpQueue.get(modId) === tail) modOpQueue.delete(modId);
  });
  return run;
}

/** 启用单个 mod：注册元信息，读取入口文件，按类型注入（经 per-mod 队列串行）。 */
export function enableModRuntime(mod: ModInfo): Promise<void> {
  return enqueueModOp(mod.id, async () => {
    // 幂等守卫：运行时已激活（已注入且未禁用/回滚）时跳过重复注入——
    // 重复 enable 会让 trackModStart 重置追踪状态，使首批监听器脱管泄漏。
    if (isModRuntimeActive(mod.id)) return;
    await enableModRuntimeInner(mod);
  });
}

async function enableModRuntimeInner(mod: ModInfo): Promise<void> {
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
    showToast(`Mod "${mod.name}" 加载失败：${msg}`, "error");
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
 * 经 per-mod 队列串行：与 enable/reload 互斥，等待前序操作完成后执行。
 * @param skipClearLifecycle 为 true 时保留生命周期注册表（用于 uninstall 流程）
 */
export function disableModRuntime(mod: ModInfo, skipClearLifecycle?: boolean): Promise<void> {
  return enqueueModOp(mod.id, () => disableModRuntimeInner(mod, skipClearLifecycle));
}

async function disableModRuntimeInner(mod: ModInfo, skipClearLifecycle?: boolean): Promise<void> {
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

/** 热重载单个 mod：清理与重新启用作为同一队列操作原子执行，不被其它操作插入 */
export function reloadModRuntime(mod: ModInfo): Promise<void> {
  return enqueueModOp(mod.id, async () => {
    await disableModRuntimeInner(mod);
    await enableModRuntimeInner(mod);
  });
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
        showToast(`Mod "${mod.name}" 依赖未满足，已跳过加载：${reasons.join("；")}`, "warning");
      }
    }

    const { sorted, cycles } = topologicalSort(validMods);

    if (cycles.length > 0) {
      console.warn(`[modRuntime] 检测到循环依赖，受影响 mod：${cycles.join(", ")}`);
      showToast(`检测到 Mod 循环依赖：${cycles.join(", ")}，加载顺序可能不正确`, "warning");
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

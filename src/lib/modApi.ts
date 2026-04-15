// ============================================================================
// lib/modApi.ts — 暴露给 JS Mod 的全局 API（v2.2）
// ============================================================================
//
// 使用方式（在 mod JS 中）：
//   const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
//
//   // manifest 中声明了 permissions → 仅允许声明的操作
//   // manifest 中未声明 permissions（旧 mod）→ 不受限（向后兼容）
//   // manifest 中声明 permissions: [] → 无任何权限
//   const items = await api.getItems();          // 需要 items:read
//   await api.addItem("C:\\path\\to\\file.exe"); // 需要 items:write
//
//   // 清理钩子（强烈建议注册，否则禁用 mod 时会警告）
//   api.onDisable(() => clearInterval(timer));
//
//   // 存储
//   api.storage.set("key", "value");
//
//   // UI
//   api.notify("操作完成", "success");
//
// ============================================================================

import * as db from "./db";
import type { Item, ItemWithTags, Tag, Cabinet } from "../types";
import type { ModPermission } from "../types/mod";

type ToastType = "info" | "success" | "error" | "warning";

// ── 类型定义 ─────────────────────────────────────────────────────────────

interface ModStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
}

interface ModScope {
  id: string;
  storage: ModStorage;
  // 主题（读取不需要权限，setThemeVariable 需要 theme 权限）
  getThemeVariable(name: string): string;
  setThemeVariable(name: string, value: string): void;
  getThemeId(): string;
  onThemeChange(cb: (themeId: string) => void): () => void;
  // 数据读取
  getItems(): Promise<ItemWithTags[]>;
  getTags(): Promise<Tag[]>;
  getCabinets(): Promise<Cabinet[]>;
  // 数据写入
  addItem(path: string): Promise<Item>;
  removeItem(id: number): Promise<void>;
  addTag(name: string, color: string): Promise<Tag>;
  updateTag(id: number, name: string, color: string): Promise<void>;
  removeTag(id: number): Promise<void>;
  setItemTags(itemId: number, tagIds: number[]): Promise<void>;
  launchItem(id: number): Promise<void>;
  toggleFavorite(id: number): Promise<boolean>;
  addCabinet(name: string, color: string): Promise<Cabinet>;
  updateCabinet(id: number, name: string, color: string): Promise<void>;
  removeCabinet(id: number): Promise<void>;
  addItemToCabinet(cabinetId: number, itemId: number): Promise<void>;
  removeItemFromCabinet(cabinetId: number, itemId: number): Promise<void>;
  // 事件
  onSearchInput(cb: (query: string) => void): () => void;
  onItemLaunched(cb: (itemId: number, itemName: string) => void): () => void;
  onItemsChanged(cb: (items: ItemWithTags[]) => void): () => void;
  onTagsChanged(cb: (tags: Tag[]) => void): () => void;
  onCabinetsChanged(cb: (cabinets: Cabinet[]) => void): () => void;
  // UI
  notify(message: string, type?: ToastType): void;
  /** 注册 mod 被禁用时的清理回调（推荐始终注册，避免内存泄漏；支持返回 Promise） */
  onDisable(cb: () => void | Promise<void>): void;
}

interface TagLauncherModApi {
  version: string;
  createScope(modId: string): ModScope;
  // 主题
  getThemeVariable(name: string): string;
  setThemeVariable(name: string, value: string): void;
  getThemeId(): string;
  onThemeChange(cb: (themeId: string) => void): () => void;
  // 数据读取
  getItems(): Promise<ItemWithTags[]>;
  getTags(): Promise<Tag[]>;
  getCabinets(): Promise<Cabinet[]>;
  // 数据写入
  addItem(path: string): Promise<Item>;
  removeItem(id: number): Promise<void>;
  addTag(name: string, color: string): Promise<Tag>;
  updateTag(id: number, name: string, color: string): Promise<void>;
  removeTag(id: number): Promise<void>;
  setItemTags(itemId: number, tagIds: number[]): Promise<void>;
  launchItem(id: number): Promise<void>;
  toggleFavorite(id: number): Promise<boolean>;
  addCabinet(name: string, color: string): Promise<Cabinet>;
  updateCabinet(id: number, name: string, color: string): Promise<void>;
  removeCabinet(id: number): Promise<void>;
  addItemToCabinet(cabinetId: number, itemId: number): Promise<void>;
  removeItemFromCabinet(cabinetId: number, itemId: number): Promise<void>;
  // 事件
  onSearchInput(cb: (query: string) => void): () => void;
  onItemLaunched(cb: (itemId: number, itemName: string) => void): () => void;
  onItemsChanged(cb: (items: ItemWithTags[]) => void): () => void;
  onTagsChanged(cb: (tags: Tag[]) => void): () => void;
  onCabinetsChanged(cb: (cabinets: Cabinet[]) => void): () => void;
  // UI
  notify(message: string, type?: ToastType): void;
}

// ── 当前 API 版本 ────────────────────────────────────────────────────────
const API_VERSION = "2.2.0";

// ── 内部监听器集合 ────────────────────────────────────────────────────────

const themeChangeListeners     = new Set<(id: string) => void>();
const searchInputListeners     = new Set<(q: string) => void>();
const itemLaunchedListeners    = new Set<(id: number, name: string) => void>();
const itemsChangedListeners    = new Set<(items: ItemWithTags[]) => void>();
const tagsChangedListeners     = new Set<(tags: Tag[]) => void>();
const cabinetsChangedListeners = new Set<(cabs: Cabinet[]) => void>();

// ── 公共通知函数（由应用 hooks 调用）──────────────────────────────────────

export function notifyThemeChange(id: string) {
  for (const cb of themeChangeListeners)  try { cb(id); } catch { /* */ }
}
export function notifySearchInput(q: string) {
  for (const cb of searchInputListeners)  try { cb(q); } catch { /* */ }
}
export function notifyItemLaunched(id: number, name: string) {
  for (const cb of itemLaunchedListeners) try { cb(id, name); } catch { /* */ }
}
export function notifyItemsChanged(items: ItemWithTags[]) {
  for (const cb of itemsChangedListeners) try { cb(items); } catch { /* */ }
}
export function notifyTagsChanged(tags: Tag[]) {
  for (const cb of tagsChangedListeners)  try { cb(tags); } catch { /* */ }
}
export function notifyCabinetsChanged(cabs: Cabinet[]) {
  for (const cb of cabinetsChangedListeners) try { cb(cabs); } catch { /* */ }
}

// ── 权限注册表 ────────────────────────────────────────────────────────────

/** modId → 已授权的权限集合（undefined = 不限制） */
const modPermissionsMap = new Map<string, Set<ModPermission>>();

/**
 * 注册 mod 的权限声明（由 modRuntime 在注入前调用）。
 * permissions 为 undefined → 不限制（向后兼容：旧 mod 未声明 permissions 字段）
 * permissions 为空数组    → 无任何权限（显式声明无需任何权限）
 * permissions 为非空数组  → 仅允许声明的权限
 */
export function registerModPermissions(modId: string, permissions: ModPermission[] | undefined): void {
  if (permissions === undefined) {
    modPermissionsMap.delete(modId); // 未声明 = 不限制
  } else {
    modPermissionsMap.set(modId, new Set(permissions)); // 显式声明（含空数组）= 严格限制
  }
}

function hasPermission(modId: string, permission: ModPermission): boolean {
  const perms = modPermissionsMap.get(modId);
  if (!perms) return true; // 未限制
  return perms.has(permission);
}

function requirePermission(modId: string, permission: ModPermission, opName: string): void {
  if (!hasPermission(modId, permission)) {
    throw new Error(
      `[Mod "${modId}"] 无权限执行 ${opName}（需要 "${permission}"）`
    );
  }
}

// ── API 版本注册表 ────────────────────────────────────────────────────────

const modApiVersionMap = new Map<string, string>();

/**
 * 注册 mod 声明的目标 API 版本（由 modRuntime 在注入前调用）。
 */
export function registerModApiVersion(modId: string, apiVersion: string | undefined): void {
  if (apiVersion) {
    modApiVersionMap.set(modId, apiVersion);
  } else {
    modApiVersionMap.delete(modId);
  }
}

/**
 * 检查 mod 的 API 版本是否与当前 API 兼容。
 * 返回 null（兼容）或 警告消息（不完全兼容但不阻断）或 Error（主版本不兼容，阻断）。
 */
function checkApiVersionCompatibility(modId: string): string | null {
  const declared = modApiVersionMap.get(modId);
  if (!declared) return null; // 未声明，不检查

  const parseSemver = (s: string): [number, number, number] => {
    const parts = s.split(".").map((p) => parseInt(p, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const [curMaj, curMin] = parseSemver(API_VERSION);
  const [reqMaj, reqMin] = parseSemver(declared);

  if (reqMaj !== curMaj) {
    // 主版本不同：不兼容，返回警告但不阻断执行
    return `[Mod "${modId}"] API 主版本不兼容：mod 需要 v${declared}，当前 API 为 v${API_VERSION}`;
  }
  if (reqMin > curMin) {
    // 次版本更高：可能使用了当前不存在的 API
    return `[Mod "${modId}"] API 次版本较新（mod 需要 v${declared}，当前 API 为 v${API_VERSION}），部分功能可能不可用`;
  }
  return null;
}

// ── 清理回调注册表 ─────────────────────────────────────────────────────────

const modCleanupRegistry = new Map<string, () => void | Promise<void>>();

/** 注册 mod 禁用时的清理回调（由 mod 自身通过 api.onDisable 调用） */
export function registerModCleanup(modId: string, cb: () => void | Promise<void>): void {
  modCleanupRegistry.set(modId, cb);
}

/**
 * 执行并移除 mod 的清理回调。返回是否存在清理函数。
 * 支持异步清理回调，超过 500ms 则强制继续并打印警告。
 */
export async function callModCleanup(modId: string): Promise<boolean> {
  const cb = modCleanupRegistry.get(modId);
  if (cb) {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 500),
    );
    try {
      await Promise.race([Promise.resolve(cb()), timeout]);
    } catch (e) {
      if (e instanceof Error && e.message === "timeout") {
        console.warn(`[modApi] Mod "${modId}" 的清理回调超过 500ms，已强制继续`);
      }
      // 其他异常静默忽略
    }
    modCleanupRegistry.delete(modId);
    return true;
  }
  return false;
}

// ── Storage 工厂 ─────────────────────────────────────────────────────────

function createStorage(modId: string): ModStorage {
  const prefix = `__mod::${modId}::`;
  return {
    get:    (k) => localStorage.getItem(`${prefix}${k}`),
    set:    (k, v) => localStorage.setItem(`${prefix}${k}`, v),
    remove: (k) => localStorage.removeItem(`${prefix}${k}`),
    clear:  () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .forEach((k) => localStorage.removeItem(k)),
  };
}

// ── 核心方法实现 ──────────────────────────────────────────────────────────

// 主题
function getThemeVariable(n: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
}
function setThemeVariable(n: string, v: string) {
  document.documentElement.style.setProperty(`--${n}`, v);
}
function getThemeId() {
  return document.documentElement.getAttribute("data-theme-id") ?? "";
}
function onThemeChange(cb: (id: string) => void) {
  themeChangeListeners.add(cb);
  return () => { themeChangeListeners.delete(cb); };
}

// 数据读取
function getItems():    Promise<ItemWithTags[]> { return db.getItems(); }
function getTags():     Promise<Tag[]>          { return db.getTags(); }
function getCabinets(): Promise<Cabinet[]>      { return db.getCabinets(); }

// 数据写入
function addItem(path: string):                            Promise<Item>    { return db.addItem(path); }
function removeItem(id: number):                           Promise<void>    { return db.removeItem(id); }
function addTag(name: string, color: string):              Promise<Tag>     { return db.addTag(name, color); }
function updateTag(id: number, n: string, c: string):      Promise<void>    { return db.updateTag(id, n, c); }
function removeTag(id: number):                            Promise<void>    { return db.removeTag(id); }
function setItemTags(itemId: number, tagIds: number[]):    Promise<void>    { return db.setItemTags(itemId, tagIds); }
function launchItem(id: number):                           Promise<void>    { return db.launchItem(id); }
function toggleFavorite(id: number):                       Promise<boolean> { return db.toggleFavorite(id); }
function addCabinet(name: string, color: string):          Promise<Cabinet> { return db.addCabinet(name, color); }
function updateCabinet(id: number, n: string, c: string):  Promise<void>    { return db.updateCabinet(id, n, c); }
function removeCabinet(id: number):                        Promise<void>    { return db.removeCabinet(id); }
function addItemToCabinet(cId: number, iId: number):       Promise<void>    { return db.addItemToCabinet(cId, iId); }
function removeItemFromCabinet(cId: number, iId: number):  Promise<void>    { return db.removeItemFromCabinet(cId, iId); }

// 事件
function onSearchInput(cb: (q: string) => void)                   { searchInputListeners.add(cb);     return () => { searchInputListeners.delete(cb); }; }
function onItemLaunched(cb: (id: number, name: string) => void)   { itemLaunchedListeners.add(cb);    return () => { itemLaunchedListeners.delete(cb); }; }
function onItemsChanged(cb: (i: ItemWithTags[]) => void)          { itemsChangedListeners.add(cb);    return () => { itemsChangedListeners.delete(cb); }; }
function onTagsChanged(cb: (t: Tag[]) => void)                    { tagsChangedListeners.add(cb);     return () => { tagsChangedListeners.delete(cb); }; }
function onCabinetsChanged(cb: (c: Cabinet[]) => void)            { cabinetsChangedListeners.add(cb); return () => { cabinetsChangedListeners.delete(cb); }; }

// UI
function notify(msg: string, type: ToastType = "info") {
  window.dispatchEvent(new CustomEvent("taglauncher-toast", { detail: { message: msg, type } }));
}

// ── createScope ────────────────────────────────────────────────────────────

function createScope(modId: string): ModScope {
  // API 版本兼容性检查
  const apiWarning = checkApiVersionCompatibility(modId);
  if (apiWarning) {
    console.warn(apiWarning);
    notify(apiWarning, "warning");
  }

  // 权限检查包装器
  function guarded<T extends unknown[], R>(
    permission: ModPermission,
    opName: string,
    fn: (...args: T) => R,
  ): (...args: T) => R {
    return (...args: T) => {
      requirePermission(modId, permission, opName);
      return fn(...args);
    };
  }

  const storage = createStorage(modId);

  return {
    id: modId,
    storage,

    // 主题（读取无权限要求，写入需要 theme 权限）
    getThemeVariable,
    setThemeVariable: guarded("theme", "setThemeVariable", setThemeVariable),
    getThemeId,
    onThemeChange,

    // 数据读取
    getItems:    guarded("items:read",    "getItems",    getItems),
    getTags:     guarded("tags:read",     "getTags",     getTags),
    getCabinets: guarded("cabinets:read", "getCabinets", getCabinets),

    // 数据写入
    addItem:               guarded("items:write",    "addItem",               addItem),
    removeItem:            guarded("items:write",    "removeItem",            removeItem),
    addTag:                guarded("tags:write",     "addTag",                addTag),
    updateTag:             guarded("tags:write",     "updateTag",             updateTag),
    removeTag:             guarded("tags:write",     "removeTag",             removeTag),
    setItemTags:           guarded("items:write",    "setItemTags",           setItemTags),
    launchItem:            guarded("launch",         "launchItem",            launchItem),
    toggleFavorite:        guarded("items:write",    "toggleFavorite",        toggleFavorite),
    addCabinet:            guarded("cabinets:write", "addCabinet",            addCabinet),
    updateCabinet:         guarded("cabinets:write", "updateCabinet",         updateCabinet),
    removeCabinet:         guarded("cabinets:write", "removeCabinet",         removeCabinet),
    addItemToCabinet:      guarded("cabinets:write", "addItemToCabinet",      addItemToCabinet),
    removeItemFromCabinet: guarded("cabinets:write", "removeItemFromCabinet", removeItemFromCabinet),

    // 事件（读取权限）
    onSearchInput,
    onItemLaunched,
    onItemsChanged:    guarded("items:read",    "onItemsChanged",    onItemsChanged),
    onTagsChanged:     guarded("tags:read",     "onTagsChanged",     onTagsChanged),
    onCabinetsChanged: guarded("cabinets:read", "onCabinetsChanged", onCabinetsChanged),

    // UI
    notify,

    // 清理回调注册
    onDisable: (cb: () => void | Promise<void>) => registerModCleanup(modId, cb),
  };
}

// ── 全局 API（不走权限检查，供应用内部使用） ─────────────────────────────

export const modApi: TagLauncherModApi = {
  version: API_VERSION,
  createScope,
  getThemeVariable, setThemeVariable, getThemeId, onThemeChange,
  getItems, getTags, getCabinets,
  addItem, removeItem, addTag, updateTag, removeTag, setItemTags,
  launchItem, toggleFavorite,
  addCabinet, updateCabinet, removeCabinet, addItemToCabinet, removeItemFromCabinet,
  onSearchInput, onItemLaunched, onItemsChanged, onTagsChanged, onCabinetsChanged,
  notify,
};

export function initModApi() {
  (window as unknown as Record<string, unknown>).__tagLauncherModApi = modApi;
}

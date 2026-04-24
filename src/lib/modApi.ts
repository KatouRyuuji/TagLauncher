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
import type { PanelOptions, PanelHandle } from "../types/panel";
import { requestPanel, destroyAllForMod } from "./panelRegistry";
import { createModUiKit, type ModUiKit } from "./modUiKit";
import {
  registerToolbarButton,
  unregisterToolbarButton,
  unregisterAllToolbarButtons,
} from "./modToolbarRegistry";
import {
  registerItemSlot,
  unregisterItemSlot,
  unregisterAllItemSlots,
  type ItemSlotPosition,
} from "./modItemSlotRegistry";

type ToastType = "info" | "success" | "error" | "warning";
type LifecycleType = "enable" | "disable" | "uninstall" | "install" | "update";

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
  data: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    list(collection: string): Promise<unknown[]>;
    put(collection: string, id: string, value: unknown): Promise<void>;
    delete(collection: string, id: string): Promise<void>;
  };
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
  // 文件系统
  fs: {
    readText(path: string): Promise<string>;
    readBytes(path: string): Promise<number[]>;
    writeText(path: string, content: string): Promise<void>;
    writeBytes(path: string, bytes: number[]): Promise<void>;
    list(path: string): Promise<Array<{ name: string; isFile: boolean; isDir: boolean }>>;
    remove(path: string): Promise<void>;
  };
  // 网络（占位）
  net: {
    fetch(url: string, options?: RequestInit): Promise<Response>;
  };
  // 事件通信
  events: {
    emit(eventName: string, data?: unknown): void;
    on(eventName: string, cb: (data: unknown, sourceModId: string) => void): () => void;
  };
  // UI
  notify(message: string, type?: ToastType): void;
  /** 注册 mod 生命周期回调（enable / disable / uninstall） */
  onLifecycle(type: LifecycleType, cb: () => void | Promise<void>): void;
  /**
   * 在应用内创建 UI 面板。需要 "dom" 权限。
   * 返回 Promise<PanelHandle>，React 挂载容器后 resolve。
   * handle.container 是内容 div，可直接写入 innerHTML 或 appendChild。
   */
  createPanel(id: string, options: PanelOptions): Promise<PanelHandle>;
  /** 标准化 UI 组件库（不需要额外权限） */
  ui: ModUiKit;
  // Toolbar 扩展
  /**
   * 在应用顶部工具栏注册一个快捷按钮。需要 "dom" 权限。
   * @param buttonId 按钮唯一标识（在 mod 作用域内唯一）
   * @param opts 按钮配置
   */
  createToolbarButton(buttonId: string, opts: { text: string; icon?: string; onClick: () => void }): void;
  /** 注销工具栏按钮 */
  removeToolbarButton(buttonId: string): void;
  // ItemCard 插槽扩展
  /**
   * 在 ItemCard 中注册自定义渲染插槽。需要 "dom" 权限。
   * @param slotId 插槽唯一标识（在 mod 作用域内唯一）
   * @param position 插槽位置："header"（标题旁）/ "footer"（卡片底部）/ "actions"（操作区）
   * @param render 渲染函数，接收 item 数据返回 HTMLElement
   */
  registerItemSlot(slotId: string, position: ItemSlotPosition, render: (item: ItemWithTags) => HTMLElement): void;
  /** 注销 ItemCard 插槽 */
  unregisterItemSlot(slotId: string): void;
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
const API_VERSION = "3.0.0";

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

// ── 生命周期回调注册表 ─────────────────────────────────────────────────────

const modLifecycleRegistry = new Map<string, Map<LifecycleType, () => void | Promise<void>>>();

/** 注册 mod 生命周期回调（enable / disable / uninstall） */
export function registerModLifecycle(
  modId: string,
  type: LifecycleType,
  cb: () => void | Promise<void>,
): void {
  if (!modLifecycleRegistry.has(modId)) {
    modLifecycleRegistry.set(modId, new Map());
  }
  modLifecycleRegistry.get(modId)!.set(type, cb);
}

/**
 * 执行 mod 生命周期回调。返回是否存在回调。
 * 支持异步回调，超过 500ms 则强制继续并打印警告。
 */
export async function callModLifecycle(modId: string, type: LifecycleType): Promise<boolean> {
  const map = modLifecycleRegistry.get(modId);
  const cb = map?.get(type);
  if (cb && map) {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 500),
    );
    try {
      await Promise.race([Promise.resolve(cb()), timeout]);
    } catch (e) {
      if (e instanceof Error && e.message === "timeout") {
        console.warn(`[modApi] Mod "${modId}" 的 ${type} 回调超过 500ms，已强制继续`);
      }
      // 其他异常静默忽略
    }
    map.delete(type);
    return true;
  }
  return false;
}

/** 移除 mod 的所有生命周期回调 */
export function clearModLifecycle(modId: string): void {
  modLifecycleRegistry.delete(modId);
}

// ── Mod 状态追踪 ──────────────────────────────────────────────────────────

interface ModTrackedState {
  /** 所有通过 scope 注册的取消监听函数 */
  unsubscribers: Array<() => void>;
}

const modTrackedStateMap = new Map<string, ModTrackedState>();

function trackUnsubscriber(modId: string, unsub: () => void): void {
  const state = modTrackedStateMap.get(modId);
  if (state) {
    state.unsubscribers.push(unsub);
  }
}

/** 注册一个新的 mod 追踪状态（在 enable 时调用） */
export function trackModStart(modId: string): void {
  modTrackedStateMap.set(modId, { unsubscribers: [] });
}

/** 取消该 mod 通过 scope 注册的所有监听器 */
function cancelModTrackedListeners(modId: string): void {
  const state = modTrackedStateMap.get(modId);
  if (state) {
    for (const unsub of state.unsubscribers) {
      try { unsub(); } catch { /* 静默忽略 */ }
    }
    modTrackedStateMap.delete(modId);
  }
}

/**
 * 强制清理 mod 的所有残留资源。
 * 在 disable / uninstall 时调用，确保即使 mod 未注册清理回调也能正确释放。
 *
 * @param skipClearLifecycle 为 true 时保留生命周期注册表（用于 uninstall 流程中
 *   先 disable 再执行 uninstall 回调的场景）
 */
export async function purgeModResources(modId: string, skipClearLifecycle?: boolean): Promise<void> {
  // 1. 调用 disable 生命周期回调
  await callModLifecycle(modId, "disable");

  // 2. 取消所有通过 scope 注册的内部监听器
  cancelModTrackedListeners(modId);

  // 3. 事件总线中的回调会在 listener 被清理时自动移除

  // 4. 销毁所有 Panel
  destroyAllForMod(modId);

  // 5. 注销所有 Toolbar 按钮
  unregisterAllToolbarButtons(modId);

  // 6. 注销所有 ItemCard 插槽
  unregisterAllItemSlots(modId);

  // 7. 清理生命周期注册表（可选跳过）
  if (!skipClearLifecycle) {
    clearModLifecycle(modId);
  }

  // 8. 移除权限和 API 版本注册
  modPermissionsMap.delete(modId);
  modApiVersionMap.delete(modId);
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

function parseJsonOrNull(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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

// ── 文件系统 ───────────────────────────────────────────────────────────────

function readModFile(modId: string, path: string): Promise<string>     { return db.readModFile(modId, path); }
function readModFileBytes(modId: string, path: string): Promise<number[]> { return db.readModFileBytes(modId, path); }
function writeModFile(modId: string, path: string, content: string): Promise<void> { return db.writeModFile(modId, path, content); }
function writeModFileBytes(modId: string, path: string, bytes: number[]): Promise<void> { return db.writeModFileBytes(modId, path, bytes); }
function listModFiles(modId: string, path: string): Promise<Array<{ name: string; isFile: boolean; isDir: boolean }>> { return db.listModFiles(modId, path).then((list) => list.map((e) => ({ name: e.name, isFile: e.is_file, isDir: e.is_dir }))); }
function removeModFile(modId: string, path: string): Promise<void>     { return db.removeModFile(modId, path); }

// ── 网络（占位）────────────────────────────────────────────────────────────

function netFetchPlaceholder(): Promise<Response> {
  throw new Error("网络 API 尚未实现（net API is not yet implemented）");
}

// ── 事件通信 ───────────────────────────────────────────────────────────────

const eventBus = new Map<string, Set<(data: unknown, sourceModId: string) => void>>();

function emitEvent(modId: string, eventName: string, data: unknown): void {
  const listeners = eventBus.get(eventName);
  if (!listeners) return;
  for (const cb of listeners) {
    try { cb(data, modId); } catch { /* 静默忽略 */ }
  }
}

function onEvent(_modId: string, eventName: string, cb: (data: unknown, sourceModId: string) => void): () => void {
  if (!eventBus.has(eventName)) eventBus.set(eventName, new Set());
  eventBus.get(eventName)!.add(cb);
  return () => { eventBus.get(eventName)?.delete(cb); };
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
  const data = {
    get: async (key: string) => parseJsonOrNull(await db.modKvGet(modId, key)),
    set: async (key: string, value: unknown) => db.modKvSet(modId, key, JSON.stringify(value)),
    remove: async (key: string) => db.modKvRemove(modId, key),
    list: async (collection: string) => (await db.modRecordsList(modId, collection)).map(parseJsonOrNull),
    put: async (collection: string, id: string, value: unknown) => db.modRecordPut(modId, collection, id, JSON.stringify(value)),
    delete: async (collection: string, id: string) => db.modRecordRemove(modId, collection, id),
  };

  // 包装所有 listener 注册函数，使它们能被自动追踪和清理
  function scopedOnThemeChange(cb: (id: string) => void) {
    const unsub = onThemeChange(cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }
  function scopedOnSearchInput(cb: (q: string) => void) {
    const unsub = onSearchInput(cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }
  function scopedOnItemLaunched(cb: (id: number, name: string) => void) {
    const unsub = onItemLaunched(cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }
  function scopedOnItemsChanged(cb: (i: ItemWithTags[]) => void) {
    const unsub = onItemsChanged(cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }
  function scopedOnTagsChanged(cb: (t: Tag[]) => void) {
    const unsub = onTagsChanged(cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }
  function scopedOnCabinetsChanged(cb: (c: Cabinet[]) => void) {
    const unsub = onCabinetsChanged(cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }
  function scopedOnEvent(eventName: string, cb: (data: unknown, sourceModId: string) => void) {
    const unsub = onEvent(modId, eventName, cb);
    trackUnsubscriber(modId, unsub);
    return unsub;
  }

  return {
    id: modId,
    storage,
    data: {
      get: guarded("data", "data.get", data.get),
      set: guarded("data", "data.set", data.set),
      remove: guarded("data", "data.remove", data.remove),
      list: guarded("data", "data.list", data.list),
      put: guarded("data", "data.put", data.put),
      delete: guarded("data", "data.delete", data.delete),
    },

    // 主题（读取无权限要求，写入需要 theme 权限）
    getThemeVariable,
    setThemeVariable: guarded("theme", "setThemeVariable", setThemeVariable),
    getThemeId,
    onThemeChange: scopedOnThemeChange,

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
    onSearchInput:     scopedOnSearchInput,
    onItemLaunched:    scopedOnItemLaunched,
    onItemsChanged:    guarded("items:read",    "onItemsChanged",    scopedOnItemsChanged),
    onTagsChanged:     guarded("tags:read",     "onTagsChanged",     scopedOnTagsChanged),
    onCabinetsChanged: guarded("cabinets:read", "onCabinetsChanged", scopedOnCabinetsChanged),

    // 文件系统
    fs: {
      readText:  guarded("fs:read",  "fs.readText",  (path: string) => readModFile(modId, path)),
      readBytes: guarded("fs:read",  "fs.readBytes", (path: string) => readModFileBytes(modId, path)),
      writeText: guarded("fs:write", "fs.writeText", (path: string, content: string) => writeModFile(modId, path, content)),
      writeBytes: guarded("fs:write", "fs.writeBytes", (path: string, bytes: number[]) => writeModFileBytes(modId, path, bytes)),
      list:      guarded("fs:read",  "fs.list",      (path: string) => listModFiles(modId, path)),
      remove:    guarded("fs:write", "fs.remove",    (path: string) => removeModFile(modId, path)),
    },

    // 网络（占位）
    net: {
      fetch: guarded("net", "net.fetch", netFetchPlaceholder),
    },

    // 事件通信
    events: {
      emit: guarded("events:emit",    "events.emit", (eventName: string, data?: unknown) => emitEvent(modId, eventName, data)),
      on:   guarded("events:receive", "events.on",   scopedOnEvent),
    },

    // UI
    notify,

    // 生命周期回调注册
    onLifecycle: (type: LifecycleType, cb: () => void | Promise<void>) =>
      registerModLifecycle(modId, type, cb),

    // Panel API（需要 "dom" 权限）
    createPanel: guarded("dom", "createPanel", (id: string, opts: PanelOptions) =>
      requestPanel(modId, id, opts)
    ),

    // 标准化 UI 组件库
    ui: createModUiKit(),

    // Toolbar 按钮注入（需要 "dom" 权限）
    createToolbarButton: guarded("dom", "createToolbarButton", (buttonId: string, opts: { text: string; icon?: string; onClick: () => void }) =>
      registerToolbarButton(modId, buttonId, opts)
    ),
    removeToolbarButton: guarded("dom", "removeToolbarButton", (buttonId: string) =>
      unregisterToolbarButton(modId, buttonId)
    ),

    // ItemCard 插槽注入（需要 "dom" 权限）
    registerItemSlot: guarded("dom", "registerItemSlot", (slotId: string, position: ItemSlotPosition, render: (item: ItemWithTags) => HTMLElement) =>
      registerItemSlot(modId, slotId, position, render)
    ),
    unregisterItemSlot: guarded("dom", "unregisterItemSlot", (slotId: string) =>
      unregisterItemSlot(modId, slotId)
    ),
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

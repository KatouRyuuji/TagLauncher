// ============================================================================
// lib/modApi.ts — 暴露给 JS Mod 的全局 API（v2.1）
// ============================================================================
//
// 使用方式（在 mod JS 中）：
//   const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
//
//   // 读取数据
//   const items = await api.getItems();
//   const tags  = await api.getTags();
//
//   // 写入数据（需要对应权限声明）
//   await api.addItem("C:\\path\\to\\file.exe");
//   await api.addTag("工具", "#3b82f6");
//   await api.setItemTags(1, [2, 3]);
//   await api.launchItem(1);
//   await api.toggleFavorite(1);
//
//   // 订阅数据变更
//   api.onItemsChanged((items) => console.log("items updated:", items.length));
//   api.onTagsChanged((tags) => console.log("tags updated:", tags.length));
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

// ── 内部监听器集合 ────────────────────────────────────────────────────────

const themeChangeListeners    = new Set<(id: string) => void>();
const searchInputListeners    = new Set<(q: string) => void>();
const itemLaunchedListeners   = new Set<(id: number, name: string) => void>();
const itemsChangedListeners   = new Set<(items: ItemWithTags[]) => void>();
const tagsChangedListeners    = new Set<(tags: Tag[]) => void>();
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

// ── Storage 工厂 ─────────────────────────────────────────────────────────

function createStorage(modId: string): ModStorage {
  const prefix = `__mod::${modId}::`;
  return {
    get:    (k) => localStorage.getItem(`${prefix}${k}`),
    set:    (k, v) => localStorage.setItem(`${prefix}${k}`, v),
    remove: (k) => localStorage.removeItem(`${prefix}${k}`),
    clear:  () => Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k)),
  };
}

// ── 核心方法实现 ──────────────────────────────────────────────────────────

// 主题
function getThemeVariable(n: string)          { return getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(); }
function setThemeVariable(n: string, v: string) { document.documentElement.style.setProperty(`--${n}`, v); }
function getThemeId()                          { return document.documentElement.getAttribute("data-theme-id") ?? ""; }
function onThemeChange(cb: (id: string) => void) { themeChangeListeners.add(cb); return () => { themeChangeListeners.delete(cb); }; }

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
function onSearchInput(cb: (q: string) => void)                   { searchInputListeners.add(cb);    return () => { searchInputListeners.delete(cb); }; }
function onItemLaunched(cb: (id: number, name: string) => void)   { itemLaunchedListeners.add(cb);   return () => { itemLaunchedListeners.delete(cb); }; }
function onItemsChanged(cb: (i: ItemWithTags[]) => void)          { itemsChangedListeners.add(cb);   return () => { itemsChangedListeners.delete(cb); }; }
function onTagsChanged(cb: (t: Tag[]) => void)                    { tagsChangedListeners.add(cb);    return () => { tagsChangedListeners.delete(cb); }; }
function onCabinetsChanged(cb: (c: Cabinet[]) => void)            { cabinetsChangedListeners.add(cb); return () => { cabinetsChangedListeners.delete(cb); }; }

// UI
function notify(msg: string, type: ToastType = "info") {
  window.dispatchEvent(new CustomEvent("taglauncher-toast", { detail: { message: msg, type } }));
}

// ── createScope ────────────────────────────────────────────────────────────

function createScope(modId: string): ModScope {
  return {
    id: modId,
    storage: createStorage(modId),
    getThemeVariable, setThemeVariable, getThemeId, onThemeChange,
    getItems, getTags, getCabinets,
    addItem, removeItem, addTag, updateTag, removeTag, setItemTags,
    launchItem, toggleFavorite,
    addCabinet, updateCabinet, removeCabinet, addItemToCabinet, removeItemFromCabinet,
    onSearchInput, onItemLaunched, onItemsChanged, onTagsChanged, onCabinetsChanged,
    notify,
  };
}

// ── 全局 API ──────────────────────────────────────────────────────────────

export const modApi: TagLauncherModApi = {
  version: "2.1.0",
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

import type { Item } from "../types";
import { getItemVisual } from "./db";

type Listener = (path: string | null) => void;
interface Entry {
  item: Item;
  listeners: Set<Listener>;
  running: boolean;
  value?: string | null;
  expiresAt: number;
}

const entries = new Map<string, Entry>();
const MAX_CONCURRENT = 4;
const MAX_CACHED = 512;
let running = 0;

export function itemVisualKey(item: Item): string {
  return JSON.stringify([item.id, item.path, item.type, item.is_missing, item.icon_path]);
}

/** 自定义图标与图片本身可以直接显示，失效对象保留类型图标。 */
export function immediateItemVisual(item: Item): string | null | undefined {
  if (item.icon_path?.trim()) return item.icon_path.trim();
  if (item.is_missing) return null;
  return item.type === "image" ? item.path : undefined;
}

function trimCache() {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_CACHED) break;
    if (!entry.running && entry.listeners.size === 0) entries.delete(key);
  }
}

function pump() {
  for (const [key, entry] of entries) {
    if (running >= MAX_CONCURRENT) break;
    if (entry.running || entry.value !== undefined || entry.listeners.size === 0) continue;
    entry.running = true;
    running++;
    void getItemVisual(entry.item.id).then((visual) => {
      entry.value = visual.path === entry.item.path ? visual.icon_path : null;
      entry.expiresAt = Date.now() + (entry.value ? 5 * 60_000 : 10_000);
    }, (error: unknown) => {
      console.warn("读取对象图标失败", error);
      entry.value = null;
      entry.expiresAt = Date.now() + 10_000;
    }).finally(() => {
      running--;
      entry.running = false;
      if (entries.get(key) === entry) {
        for (const listener of entry.listeners) listener(entry.value ?? null);
      }
      trimCache();
      pump();
    });
  }
}

/** 可见组件共享请求；组件离屏后撤销尚未开始的任务。 */
export function subscribeItemVisual(item: Item, listener: Listener): () => void {
  const immediate = immediateItemVisual(item);
  if (immediate !== undefined) {
    listener(immediate);
    return () => {};
  }
  const key = itemVisualKey(item);
  let entry = entries.get(key);
  // TTL 只淘汰可丢的缓存。仍有订阅或在途请求时保留同一条目并重新拉取，
  // 避免第二个组件挂载时把第一个组件的 listener 一起删掉。
  if (entry?.value !== undefined && entry.expiresAt <= Date.now()) {
    if (entry.running || entry.listeners.size > 0) {
      entry.value = undefined;
      entry.expiresAt = 0;
    } else {
      entries.delete(key);
      entry = undefined;
    }
  }
  if (!entry) {
    entry = { item, listeners: new Set(), running: false, expiresAt: 0 };
    entries.set(key, entry);
  }
  const subscribed = entry;
  subscribed.listeners.add(listener);
  if (subscribed.value !== undefined) listener(subscribed.value);
  else pump();
  return () => {
    subscribed.listeners.delete(listener);
    const current = entries.get(key);
    if (current?.listeners === subscribed.listeners && !current.running && current.value === undefined && current.listeners.size === 0) entries.delete(key);
    trimCache();
  };
}

/** 刷新成功时重新读取可见对象，现有订阅持续接收更新。 */
export function invalidateItemVisuals() {
  for (const [key, entry] of entries) {
    if (entry.listeners.size === 0) entries.delete(key);
    else entries.set(key, { item: entry.item, listeners: entry.listeners, running: false, expiresAt: 0 });
  }
  pump();
}

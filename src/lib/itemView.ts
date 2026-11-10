// ============================================================================
// lib/itemView.ts — 主窗分页视图：后端给全部 ID，对象数据按可视区间分页取、有上限缓存
// ----------------------------------------------------------------------------
// - ids：当前视图（已筛选排序 / 搜索命中）的全部 ID，总数、全选、批量与定位都基于它；
// - 对象数据只缓存最近用到的若干页（LRU，上限 MAX_CACHED），可视区间变化时补取缺页；
// - 写入后按 ID 就地更新缓存；全量刷新把缓存标成过期：旧数据先照常显示，用到时重取；
// - 两路通知：ID/代/写入变化换新的视图快照（持有方整体重渲染）；只是页数据到达时只通知
//   订阅了数据版本的列表组件（subscribeData），不让整个工作台为每页重渲染一次。
// ============================================================================
import type { ItemWithTags } from "../types";
import { registerPerfStats } from "./mainPerf";

export const PAGE_SIZE = 50;
export const MAX_CACHED = 3000;

export type FetchItems = (ids: number[]) => Promise<ItemWithTags[]>;

/** 只读视图：组件按它渲染（version 变即重渲染）。 */
export interface ItemView {
  readonly ids: readonly number[];
  readonly version: number;
  indexOf(id: number): number;
  get(id: number): ItemWithTags | undefined;
  at(index: number): ItemWithTags | undefined;
  /** 请求 [start, end) 区间的对象（按页补取缺失或过期的） */
  ensureRange(start: number, end: number): void;
  /** 取指定对象（缓存优先，缺的向后端取），批量操作用 */
  load(ids: readonly number[]): Promise<ItemWithTags[]>;
  /** 页数据到达（快照不变）时通知；配合 dataVersion 用于 useSyncExternalStore */
  subscribeData(fn: () => void): () => void;
  dataVersion(): number;
}

interface Slot {
  item: ItemWithTags;
  /** 取到它时的数据代；小于当前代 = 过期（全量刷新后待重取） */
  epoch: number;
}

export class ItemStore {
  private slots = new Map<number, Slot>();
  private inflight = new Set<number>();
  private epoch = 0;
  private listeners = new Set<() => void>();
  private dataListeners = new Set<() => void>();
  private dataVer = 0;
  private ids: readonly number[] = [];
  private index = new Map<number, number>();
  private version = 0;
  private readonly recentFetches: { start: number; end: number; count: number }[] = [];
  private snapshot: ItemView;
  /** 统计：页请求次数与取回对象数 */
  fetches = 0;
  fetchedItems = 0;

  constructor(private fetchItems: FetchItems, private maxCached = MAX_CACHED) {
    this.snapshot = this.makeView();
  }

  /** 规模统计（E2E 经 __tlMainPerf.stats.itemStore 读取；由持有方在挂载后登记） */
  stats() {
    return {
      ids: this.ids.length,
      cached: this.slots.size,
      fetches: this.fetches,
      fetchedItems: this.fetchedItems,
      // 最近几次取页的起止（performance.now）：E2E 拆分滚动耗时用
      recentFetches: this.recentFetches,
    };
  }

  registerPerf() {
    registerPerfStats("itemStore", () => this.stats());
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private subscribeData = (fn: () => void) => {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  };

  private getDataVersion = () => this.dataVer;

  private emit() {
    this.version += 1;
    this.dataVer += 1;
    this.snapshot = this.makeView();
    for (const fn of this.listeners) fn();
    for (const fn of this.dataListeners) fn();
  }

  /** 只有缓存内容变了（取页到达）：快照不换，只通知列表组件 */
  private emitData() {
    this.dataVer += 1;
    for (const fn of this.dataListeners) fn();
  }

  private makeView(): ItemView {
    const ids = this.ids;
    const index = this.index;
    return {
      ids,
      version: this.version,
      indexOf: (id) => index.get(id) ?? -1,
      get: (id) => this.slots.get(id)?.item,
      at: (i) => {
        const id = ids[i];
        return id === undefined ? undefined : this.slots.get(id)?.item;
      },
      ensureRange: (start, end) => this.ensureRange(start, end),
      load: (want) => this.load(want),
      subscribeData: this.subscribeData,
      dataVersion: this.getDataVersion,
    };
  }

  setIds(ids: readonly number[]) {
    this.ids = ids;
    this.index = new Map(ids.map((id, i) => [id, i] as const));
    this.emit();
  }

  /** 全量刷新：缓存整体过期（不清空，避免闪空）。 */
  invalidateAll() {
    this.epoch += 1;
    this.emit();
  }

  upsert(items: readonly ItemWithTags[]) {
    if (items.length === 0) return;
    for (const item of items) this.put(item);
    this.trim();
    this.emit();
  }

  remove(ids: readonly number[]) {
    for (const id of ids) this.slots.delete(id);
    this.emit();
  }

  /** 就地改写已缓存对象（如标签换色），不向后端取。 */
  patch(fn: (item: ItemWithTags) => ItemWithTags) {
    let changed = false;
    for (const slot of this.slots.values()) {
      const next = fn(slot.item);
      if (next !== slot.item) {
        slot.item = next;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private put(item: ItemWithTags) {
    this.slots.delete(item.id);
    this.slots.set(item.id, { item, epoch: this.epoch });
  }

  /** LRU：Map 迭代序即最近写入/使用序，超出上限时从最旧的删起（跳过当前可视区间不必要：区间远小于上限）。 */
  private trim() {
    if (this.slots.size <= this.maxCached) return;
    for (const id of this.slots.keys()) {
      if (this.slots.size <= this.maxCached) break;
      this.slots.delete(id);
    }
  }

  private touch(id: number) {
    const slot = this.slots.get(id);
    if (slot) {
      this.slots.delete(id);
      this.slots.set(id, slot);
    }
  }

  private needs(id: number) {
    const slot = this.slots.get(id);
    return !this.inflight.has(id) && (!slot || slot.epoch < this.epoch);
  }

  ensureRange(start: number, end: number) {
    const from = Math.max(0, Math.floor(start / PAGE_SIZE) * PAGE_SIZE);
    const to = Math.min(this.ids.length, Math.ceil(end / PAGE_SIZE) * PAGE_SIZE);
    const missing: number[] = [];
    for (let i = from; i < to; i++) {
      const id = this.ids[i];
      if (this.needs(id)) missing.push(id);
      else this.touch(id);
    }
    if (missing.length > 0) void this.fetch(missing, true).catch((e: unknown) => console.error("取对象页失败:", e));
    // 相邻页预取（前后各一页，单独一次请求，排在可视页之后）：连续滚动到下一页时通常已在缓存
    const ahead: number[] = [];
    const lo = Math.max(0, from - PAGE_SIZE);
    const hi = Math.min(this.ids.length, to + PAGE_SIZE);
    for (let i = lo; i < hi; i++) {
      if (i === from) i = to;
      if (i >= hi) break;
      const id = this.ids[i];
      if (this.needs(id)) ahead.push(id);
    }
    if (ahead.length > 0) void this.fetch(ahead, true).catch((e: unknown) => console.error("预取对象页失败:", e));
  }

  /**
   * 取指定对象，按 want 的顺序返回（已不存在的略去）。
   * 小批量顺带进缓存；大批量（如全选后批量操作）只返回、不进缓存，免得把可视页挤出 LRU。
   */
  async load(want: readonly number[]): Promise<ItemWithTags[]> {
    const got = new Map<number, ItemWithTags>();
    const missing: number[] = [];
    for (const id of want) {
      const slot = this.slots.get(id);
      if (slot && slot.epoch >= this.epoch) got.set(id, slot.item);
      else missing.push(id);
    }
    if (missing.length > 0) {
      const items = await this.fetch(missing, missing.length <= PAGE_SIZE * 2);
      for (const item of items) got.set(item.id, item);
    }
    const out: ItemWithTags[] = [];
    for (const id of want) {
      const item = got.get(id);
      if (item) out.push(item);
    }
    return out;
  }

  private async fetch(ids: number[], cache: boolean): Promise<ItemWithTags[]> {
    if (cache) for (const id of ids) this.inflight.add(id);
    const epoch = this.epoch;
    try {
      this.fetches += 1;
      const t0 = typeof performance === "undefined" ? 0 : performance.now();
      const items = await this.fetchItems(ids);
      this.fetchedItems += items.length;
      if (typeof performance !== "undefined") {
        this.recentFetches.push({ start: t0, end: performance.now(), count: ids.length });
        if (this.recentFetches.length > 8) this.recentFetches.shift();
      }
      const got = new Set(items.map((item) => item.id));
      if (cache) {
        for (const item of items) {
          this.slots.delete(item.id);
          this.slots.set(item.id, { item, epoch });
        }
        this.trim();
      } else {
        // 不进缓存，但已缓存的同一对象换成新数据，避免与刚取到的不一致
        for (const item of items) {
          const slot = this.slots.get(item.id);
          if (slot) this.slots.set(item.id, { item, epoch });
        }
      }
      // 取回时已被删除的对象：去掉旧缓存，避免显示幽灵数据
      for (const id of ids) if (!got.has(id)) this.slots.delete(id);
      return items;
    } finally {
      if (cache) for (const id of ids) this.inflight.delete(id);
      this.emitData();
    }
  }
}

/** 全部数据已在手的静态视图（演示/测试与小集合用）。 */
export function staticView(items: readonly ItemWithTags[]): ItemView {
  const ids = items.map((item) => item.id);
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const index = new Map(ids.map((id, i) => [id, i] as const));
  return {
    ids,
    version: 0,
    indexOf: (id) => index.get(id) ?? -1,
    get: (id) => byId.get(id),
    at: (i) => items[i],
    ensureRange: () => {},
    load: async (want) => want.flatMap((id) => byId.get(id) ?? []),
    subscribeData: () => () => {},
    dataVersion: () => 0,
  };
}

/** 把一组 ID 按视图顺序排好（不在视图里的去掉）。 */
export function orderByView(view: ItemView, ids: readonly number[]): number[] {
  return ids.filter((id) => view.indexOf(id) >= 0).sort((a, b) => view.indexOf(a) - view.indexOf(b));
}

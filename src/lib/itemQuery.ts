// ============================================================================
// lib/itemQuery.ts — 工作台排序 / 类型筛选 / 键盘选择（纯函数，无 React）
// ============================================================================
// 对照 Eagle（类型筛选、最近使用、空格预览）与启动器键盘流，把视图查询从
// 组件中抽离，保证虚拟化列表只拿到已经排好的结果，避免每张卡片重算。
// ============================================================================

import type { ItemWithTags } from "../types";

/** 工作台排序：智能（收藏→最近使用→名称）/ 名称 / 最近使用 / 添加时间 / 类型 */
export type SortMode = "smart" | "name" | "recent" | "added" | "type";

/** 类型筛选：脚本合并 bat+ps1，避免顶栏 chip 过多 */
export type TypeFilter = "all" | "folder" | "image" | "audio" | "exe" | "script";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "smart", label: "智能" },
  { value: "name", label: "名称" },
  { value: "recent", label: "最近使用" },
  { value: "added", label: "添加时间" },
  { value: "type", label: "类型" },
];

export const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "folder", label: "文件夹" },
  { value: "image", label: "图片" },
  { value: "audio", label: "音频" },
  { value: "exe", label: "程序" },
  { value: "script", label: "脚本" },
];

const TYPE_ORDER: Record<string, number> = {
  folder: 0,
  image: 1,
  audio: 2,
  exe: 3,
  bat: 4,
  ps1: 5,
};

export function isSortMode(value: unknown): value is SortMode {
  return value === "smart" || value === "name" || value === "recent" || value === "added" || value === "type";
}

export function isTypeFilter(value: unknown): value is TypeFilter {
  return value === "all" || value === "folder" || value === "image" || value === "audio" || value === "exe" || value === "script";
}

export function itemMatchesType(item: Pick<ItemWithTags, "type">, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "script") return item.type === "bat" || item.type === "ps1";
  return item.type === filter;
}

export function applyTypeFilter<T extends Pick<ItemWithTags, "type">>(items: T[], filter: TypeFilter): T[] {
  if (filter === "all") return items;
  return items.filter((item) => itemMatchesType(item, filter));
}

export function applyRecentFilter<T extends Pick<ItemWithTags, "last_used_at">>(items: T[], enabled: boolean): T[] {
  if (!enabled) return items;
  return items.filter((item) => Boolean(item.last_used_at));
}

export function compareItems(
  a: Pick<ItemWithTags, "name" | "type" | "is_favorite" | "last_used_at" | "created_at">,
  b: Pick<ItemWithTags, "name" | "type" | "is_favorite" | "last_used_at" | "created_at">,
  mode: SortMode,
): number {
  switch (mode) {
    case "name":
      return a.name.localeCompare(b.name, "zh-CN");
    case "recent": {
      const used = (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "");
      return used || a.name.localeCompare(b.name, "zh-CN");
    }
    case "added": {
      const added = b.created_at.localeCompare(a.created_at);
      return added || a.name.localeCompare(b.name, "zh-CN");
    }
    case "type": {
      const order = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
      return order || a.name.localeCompare(b.name, "zh-CN");
    }
    case "smart":
    default: {
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
      const used = (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "");
      return used || a.name.localeCompare(b.name, "zh-CN");
    }
  }
}

export function sortItemsByMode<T extends Pick<ItemWithTags, "name" | "type" | "is_favorite" | "last_used_at" | "created_at">>(
  items: T[],
  mode: SortMode,
): T[] {
  return [...items].sort((a, b) => compareItems(a, b, mode));
}

/** 在搜索结果之上叠加类型筛选与排序（最近使用由 source 层互斥筛选，避免重复过滤）。 */
export function applyWorkspaceQuery<T extends ItemWithTags>(
  items: T[],
  opts: { typeFilter: TypeFilter; sortMode: SortMode },
): T[] {
  return sortItemsByMode(applyTypeFilter(items, opts.typeFilter), opts.sortMode);
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "未知大小";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : 1;
  const text = value.toFixed(digits).replace(/\.0$/, "");
  return `${text} ${units[unit]}`;
}

export function formatTimestamp(value: string | undefined | null): string {
  if (!value) return "从未";
  return value.replace("T", " ").slice(0, 19);
}

/** 键盘在结果列表中移动选中：无当前项时正向选第一项、反向选最后一项。 */
export function nextSelectionIndex(count: number, currentIndex: number, delta: number): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) return delta >= 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, currentIndex + delta));
}

export function filterCommandsByQuery<T extends { title: string; keywords: string }>(
  commands: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (command) => command.title.toLowerCase().includes(q) || command.keywords.toLowerCase().includes(q),
  );
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function sortModeLabel(mode: SortMode): string {
  return SORT_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function typeFilterLabel(filter: TypeFilter): string {
  return TYPE_FILTERS.find((option) => option.value === filter)?.label ?? filter;
}

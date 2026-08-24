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

// 排序热点：localeCompare 每次调用都会隐式构造 Collator，大库排序时开销显著。
// 模块级缓存一份 Collator 复用；numeric 开启自然数字排序（file2 < file10）。
const nameCollator = new Intl.Collator("zh-CN", { numeric: true });

/** 名称比较（缓存 Collator + 自然数字排序），全应用名称排序统一走这里。 */
export function compareNames(a: string, b: string): number {
  return nameCollator.compare(a, b);
}

/** ISO 时间戳是 ASCII 字典序可比的，纯字符串比较即可，避免 localeCompare 开销。 */
function compareTimestamps(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isSortMode(value: unknown): value is SortMode {
  return value === "smart" || value === "name" || value === "recent" || value === "added" || value === "type";
}

export function isTypeFilter(value: unknown): value is TypeFilter {
  return value === "all" || value === "folder" || value === "image" || value === "audio" || value === "exe" || value === "script";
}

/** 类型芯片再点一次回到「全部」，与筛选条、命令面板共用。 */
export function nextTypeFilter(current: TypeFilter, clicked: TypeFilter): TypeFilter {
  if (clicked === "all") return "all";
  return current === clicked ? "all" : clicked;
}

/**
 * 多选收藏：只要有未收藏项就应收藏这些项；全部已收藏则取消收藏。
 * 返回需要 toggle 的 id，已符合目标状态的项不动。
 */
export function idsNeedingFavoriteToggle(items: { id: number; is_favorite: boolean }[]): number[] {
  if (items.length === 0) return [];
  const target = items.some((item) => !item.is_favorite);
  return items.filter((item) => item.is_favorite !== target).map((item) => item.id);
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
      return compareNames(a.name, b.name);
    case "recent": {
      const used = compareTimestamps(b.last_used_at ?? "", a.last_used_at ?? "");
      return used || compareNames(a.name, b.name);
    }
    case "added": {
      const added = compareTimestamps(b.created_at, a.created_at);
      return added || compareNames(a.name, b.name);
    }
    case "type": {
      const order = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
      return order || compareNames(a.name, b.name);
    }
    case "smart":
    default: {
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
      const used = compareTimestamps(b.last_used_at ?? "", a.last_used_at ?? "");
      return used || compareNames(a.name, b.name);
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

/** 网格下上下键按列数跳转，翻页一次约 4 行；列表上下为 ±1，翻页 ±4。左右始终 ±1。 */
export function selectionStep(
  viewMode: "grid" | "list",
  lanes: number,
  key: string,
): number | null {
  const cols = Math.max(1, lanes);
  const vertical = viewMode === "grid" ? cols : 1;
  switch (key) {
    case "ArrowRight":
      return 1;
    case "ArrowLeft":
      return -1;
    case "ArrowDown":
      return vertical;
    case "ArrowUp":
      return -vertical;
    case "PageDown":
      return vertical * 4;
    case "PageUp":
      return -(vertical * 4);
    default:
      return null;
  }
}

/** 预览对象仍在当前可见列表时沿可见列表切换，否则沿全库（命令面板 Tab 预览筛出项）。 */
export function previewNavigationItems<T extends { id: number }>(
  visible: T[],
  all: T[],
  previewId: number,
): T[] {
  return visible.some((item) => item.id === previewId) ? visible : all;
}

/** 从锚点到焦点的闭区间（含两端）。焦点始终放在数组末尾，便于 Shift+↑ 继续向外扩。 */
export function rangeSelectionIds<T extends { id: number }>(
  items: T[],
  anchorId: number | null | undefined,
  focusId: number,
): number[] {
  const focusIndex = items.findIndex((item) => item.id === focusId);
  if (focusIndex < 0) return [];
  const anchorIndex = anchorId == null ? focusIndex : items.findIndex((item) => item.id === anchorId);
  const from = Math.min(anchorIndex < 0 ? focusIndex : anchorIndex, focusIndex);
  const to = Math.max(anchorIndex < 0 ? focusIndex : anchorIndex, focusIndex);
  const ids = items.slice(from, to + 1).map((item) => item.id);
  if (ids.length > 1 && ids[ids.length - 1] !== focusId) {
    return [...ids.filter((id) => id !== focusId), focusId];
  }
  return ids;
}

/** 单击 / Ctrl 加选 / Shift 范围点选。 */
export function applyPointerSelection(
  orderedIds: number[],
  selectedIds: number[],
  clickedId: number,
  opts: { shift: boolean; additive: boolean; anchorId: number | null },
): { ids: number[]; anchorId: number | null } {
  const items = orderedIds.map((id) => ({ id }));
  if (opts.shift) {
    const anchor = opts.anchorId ?? selectedIds[0] ?? clickedId;
    return { ids: rangeSelectionIds(items, anchor, clickedId), anchorId: anchor };
  }
  if (opts.additive) {
    const ids = selectedIds.includes(clickedId)
      ? selectedIds.filter((id) => id !== clickedId)
      : [...selectedIds, clickedId];
    return { ids, anchorId: clickedId };
  }
  return { ids: [clickedId], anchorId: clickedId };
}

/**
 * 右键菜单选中：已在选中集内则保持多选；否则改为只选该项（对齐资源管理器）。
 */
export function applyContextSelection(
  selectedIds: number[],
  targetId: number,
  currentAnchor: number | null,
): { ids: number[]; anchorId: number | null } {
  if (selectedIds.includes(targetId)) {
    if (selectedIds[selectedIds.length - 1] === targetId) {
      return { ids: selectedIds, anchorId: currentAnchor };
    }
    return {
      ids: [...selectedIds.filter((id) => id !== targetId), targetId],
      anchorId: currentAnchor,
    };
  }
  return { ids: [targetId], anchorId: targetId };
}

/** 菜单内方向键 / Home / End。current < 0 表示尚无焦点。 */
export function stepMenuIndex(length: number, current: number, key: string): number | null {
  if (length <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % length;
  if (key === "ArrowUp") return current < 0 ? length - 1 : (current - 1 + length) % length;
  return null;
}

import { pinyin } from "pinyin-pro";

function commandSearchHaystack(title: string, keywords: string): string {
  const pinyinTitle = pinyin(title, { toneType: "none", type: "array" }).join("");
  const pinyinInitials = pinyin(title, { pattern: "first", toneType: "none", type: "array" }).join("");
  return `${title} ${keywords} ${pinyinTitle} ${pinyinInitials}`.toLowerCase();
}

export function filterCommandsByQuery<T extends { title: string; keywords: string }>(
  commands: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((command) => commandSearchHaystack(command.title, command.keywords).includes(q));
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isImeKeyboardEvent(event: { key: string; nativeEvent: { isComposing?: boolean } }): boolean {
  return Boolean(event.nativeEvent.isComposing) || event.key === "Process";
}

/** 多选复制：单项提示「已复制路径」，多项换行拼接。 */
export function formatPathCopy(paths: string[]): { text: string; message: string } | null {
  const cleaned = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  if (cleaned.length === 0) return null;
  return {
    text: cleaned.join("\n"),
    message: cleaned.length === 1 ? "已复制路径" : `已复制 ${cleaned.length} 条路径`,
  };
}

export function sortModeLabel(mode: SortMode): string {
  return SORT_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function typeFilterLabel(filter: TypeFilter): string {
  return TYPE_FILTERS.find((option) => option.value === filter)?.label ?? filter;
}

// ============================================================================
// lib/itemQuery.ts — 工作台排序 / 类型筛选 / 键盘选择（纯函数，无 React）
// ============================================================================
// 对照 Eagle（类型筛选、最近使用、空格预览）与启动器键盘流，把视图查询从
// 组件中抽离，保证虚拟化列表只拿到已经排好的结果，避免每张卡片重算。
// ============================================================================

import { pinyinSync as pinyin } from "./pinyinProvider";
import type { ItemWithTags } from "../types";

/** 工作台排序：智能（收藏→最近使用→名称）/ 名称 / 最近使用 / 添加时间 / 类型；
 *  名称与添加时间带方向变体（-desc 后缀），其余模式固定方向。 */
export type SortMode = "smart" | "name" | "name-desc" | "recent" | "added" | "added-desc" | "type";

/** 工作台视图：卡片网格 / 大图标 / 列表 */
export type ViewMode = "grid" | "list" | "icons";

/** 列表行密度：舒适（默认 68px）/ 紧凑（56px，一屏更多行） */
export type ListDensity = "comfortable" | "compact";

export function isListDensity(value: unknown): value is ListDensity {
  return value === "comfortable" || value === "compact";
}

/** 类型筛选：脚本合并 bat+ps1，避免顶栏 chip 过多 */
export type TypeFilter = "all" | "folder" | "image" | "audio" | "video" | "exe" | "script";

export const SORT_OPTIONS: { value: SortMode; label: string; hint?: string }[] = [
  { value: "smart", label: "智能（收藏·最近）", hint: "收藏优先，其次最近使用，再按名称" },
  { value: "name", label: "名称 A→Z", hint: "按名称拼音升序" },
  { value: "name-desc", label: "名称 Z→A", hint: "按名称拼音降序" },
  { value: "recent", label: "最近使用", hint: "最近打开过的在前" },
  { value: "added", label: "添加时间（新→旧）", hint: "最新加入库的在前" },
  { value: "added-desc", label: "添加时间（旧→新）", hint: "最早加入库的在前" },
  { value: "type", label: "类型", hint: "按类型分组：文件夹、图片、音频、视频、程序、脚本" },
];

export const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "folder", label: "文件夹" },
  { value: "image", label: "图片" },
  { value: "audio", label: "音频" },
  { value: "video", label: "视频" },
  { value: "exe", label: "程序" },
  { value: "script", label: "脚本" },
];

const TYPE_ORDER: Record<string, number> = {
  folder: 0,
  image: 1,
  audio: 2,
  video: 3,
  exe: 4,
  bat: 5,
  ps1: 6,
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

export function isViewMode(value: unknown): value is ViewMode {
  return value === "grid" || value === "list" || value === "icons";
}

export function isSortMode(value: unknown): value is SortMode {
  return (
    value === "smart" ||
    value === "name" ||
    value === "name-desc" ||
    value === "recent" ||
    value === "added" ||
    value === "added-desc" ||
    value === "type"
  );
}

export function isTypeFilter(value: unknown): value is TypeFilter {
  return value === "all" || value === "folder" || value === "image" || value === "audio" || value === "video" || value === "exe" || value === "script";
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

export interface SortKeyOverrides {
  /** id → 冻结的 last_used_at（会话内冻结排序键）：命中即用冻结值，未命中用活值。
   *  启动对象只刷新 last_used_at 不重排视图（Explorer 语义）；
   *  快照在 loadAll / 排序变更 / 视图域切换时重拍。
   *  只对 smart 排序生效：显式「最近使用」排序是活视图——用户点名看最近，
   *  启动必须立即升顶，冻结会让该视图会话内失去活性。 */
  readonly lastUsedAt?: ReadonlyMap<number, string | null | undefined>;
}

type SortableItem = Pick<ItemWithTags, "id" | "name" | "type" | "is_favorite" | "last_used_at" | "created_at">;

export function compareItems(
  a: SortableItem,
  b: SortableItem,
  mode: SortMode,
  overrides?: SortKeyOverrides,
): number {
  const usedAt = (item: SortableItem) =>
    overrides?.lastUsedAt?.has(item.id) ? overrides.lastUsedAt.get(item.id) : item.last_used_at;
  switch (mode) {
    case "name":
      return compareNames(a.name, b.name);
    case "name-desc":
      return compareNames(b.name, a.name);
    case "recent": {
      // 显式「最近使用」= 活视图：不经冻结键，启动立即升顶（见 SortKeyOverrides 注释）
      const used = compareTimestamps(b.last_used_at ?? "", a.last_used_at ?? "");
      return used || compareNames(a.name, b.name);
    }
    case "added": {
      const added = compareTimestamps(b.created_at, a.created_at);
      return added || compareNames(a.name, b.name);
    }
    case "added-desc": {
      const added = compareTimestamps(a.created_at, b.created_at);
      return added || compareNames(a.name, b.name);
    }
    case "type": {
      const order = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
      return order || compareNames(a.name, b.name);
    }
    case "smart":
    default: {
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
      const used = compareTimestamps(usedAt(b) ?? "", usedAt(a) ?? "");
      return used || compareNames(a.name, b.name);
    }
  }
}

export function sortItemsByMode<T extends SortableItem>(
  items: T[],
  mode: SortMode,
  overrides?: SortKeyOverrides,
): T[] {
  return [...items].sort((a, b) => compareItems(a, b, mode, overrides));
}

/** 在搜索结果之上叠加类型筛选与排序（最近使用由 source 层互斥筛选，避免重复过滤）。 */
export function applyWorkspaceQuery<T extends ItemWithTags>(
  items: T[],
  opts: { typeFilter: TypeFilter; sortMode: SortMode; sortKeyOverrides?: SortKeyOverrides },
): T[] {
  return sortItemsByMode(applyTypeFilter(items, opts.typeFilter), opts.sortMode, opts.sortKeyOverrides);
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

/** 网格/大图标按列跳转，翻页约 4 行；列表上下为 ±1，翻页 ±4。左右始终 ±1。 */
export function selectionStep(
  viewMode: ViewMode,
  lanes: number,
  key: string,
): number | null {
  const cols = Math.max(1, lanes);
  const vertical = viewMode === "list" ? 1 : cols;
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

/** 框选模式：正选（默认，命中集替换选中集）/ 减选（Alt，扣除命中项）/ 切换（Ctrl，命中项与既有选中做对称差）。 */
export type MarqueeMode = "add" | "subtract" | "toggle";

/**
 * 框选结算：
 * - add：框选结果 = 命中集（对齐资源管理器普通框选的替换语义）；
 * - subtract（Alt+框选）：从框选前的选中集中扣除命中项，保持原有顺序；
 * - toggle（Ctrl+框选）：命中项与框选前选中集做对称差（未选中的补选、已选中的取消），
 *   对齐资源管理器 Ctrl+框选语义；新补选项追加在末尾。
 */
export function applyMarqueeSelection(
  mode: MarqueeMode,
  prevSelected: number[],
  hit: ReadonlySet<number>,
): number[] {
  if (mode === "subtract") {
    return prevSelected.filter((id) => !hit.has(id));
  }
  if (mode === "toggle") {
    const kept = prevSelected.filter((id) => !hit.has(id));
    const prevSet = new Set(prevSelected);
    const added = Array.from(hit).filter((id) => !prevSet.has(id));
    return [...kept, ...added];
  }
  return Array.from(hit);
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

function commandSearchHaystack(title: string, keywords: string): string {
  const pinyinTitle = pinyin(title, { toneType: "none", type: "array" }).join("");
  const pinyinInitials = pinyin(title, { pattern: "first", toneType: "none", type: "array" }).join("");
  return `${title} ${keywords} ${pinyinTitle} ${pinyinInitials}`.toLowerCase();
}

// 命令面板的命令列表由调用方 useMemo 稳定引用，按对象身份缓存拼音 haystack，
// 避免每次输入都对全部命令重跑 pinyin-pro。
const commandHaystackCache = new WeakMap<{ title: string; keywords: string }, string>();

export function filterCommandsByQuery<T extends { title: string; keywords: string }>(
  commands: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((command) => {
    let haystack = commandHaystackCache.get(command);
    if (!haystack) {
      haystack = commandSearchHaystack(command.title, command.keywords);
      commandHaystackCache.set(command, haystack);
    }
    return haystack.includes(q);
  });
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

// ── 列表表头点击排序 ────────────────────────────────────────────────────────

/** 列表视图中可点击切换排序的表头列。 */
export type ListHeaderColumn = "name" | "type";

const HEADER_SORT_TARGET: Record<ListHeaderColumn, SortMode> = {
  name: "name",
  type: "type",
};

/** 名称列当前是否为降序（表头指示箭头方向）。 */
export function isHeaderSortDesc(current: SortMode, column: ListHeaderColumn): boolean {
  return column === "name" && current === "name-desc";
}

/** 点击表头列：名称列循环 升序 → 降序 → 智能；类型列在 类型 ↔ 智能 间切换。 */
export function toggleHeaderSort(current: SortMode, column: ListHeaderColumn): SortMode {
  if (column === "name") {
    if (current === "name") return "name-desc";
    if (current === "name-desc") return "smart";
    return "name";
  }
  const target = HEADER_SORT_TARGET[column];
  return current === target ? "smart" : target;
}

/** 该表头列的排序当前是否生效（用于渲染排序指示箭头）。 */
export function isHeaderSortActive(current: SortMode, column: ListHeaderColumn): boolean {
  if (column === "name") return current === "name" || current === "name-desc";
  return current === HEADER_SORT_TARGET[column];
}

export function sortModeLabel(mode: SortMode): string {
  return SORT_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function typeFilterLabel(filter: TypeFilter): string {
  return TYPE_FILTERS.find((option) => option.value === filter)?.label ?? filter;
}

// ============================================================================
// quick/quickModel.ts — 快速搜索窗的纯逻辑（结果、按键映射、标签切换）
// ============================================================================
// 结果与主窗同源：runSearchPipeline（主窗 useItems 也调它），类型「全部」、无标签/柜筛选，
// 隐藏丢失对象的偏好与主窗共用 workspace_prefs。空查询显示主窗默认（智能）排序的前若干项。
// ============================================================================

import { buildSearchIndex, type SearchIndex } from "../lib/search";
import type { SearchMode } from "../stores/appStore";
import { applyMissingFilter, sortItemsByMode } from "../lib/itemQuery";
import { runSearchPipeline } from "../lib/searchPipeline";
import type { ItemWithTags } from "../types";

export const QUICK_RESULT_LIMIT = 50;

export interface QuickData {
  index: SearchIndex;
  /** 空查询时的列表（智能排序：收藏 → 最近使用 → 名称） */
  recent: ItemWithTags[];
}

export function buildQuickData(items: ItemWithTags[], mode: SearchMode): QuickData {
  return { index: buildSearchIndex(items, mode), recent: sortItemsByMode(items, "smart") };
}

export function quickResults(
  data: QuickData,
  query: string,
  opts: { hideMissing: boolean; limit?: number },
): ItemWithTags[] {
  const limit = opts.limit ?? QUICK_RESULT_LIMIT;
  if (!query.trim()) return applyMissingFilter(data.recent, opts.hideMissing).slice(0, limit);
  return runSearchPipeline(data.index, query, { typeFilter: "all", hideMissing: opts.hideMissing }).slice(0, limit);
}

export type QuickAction = "up" | "down" | "launch" | "reveal" | "copy" | "locate" | "tag" | "escape";

/** 结果列表上的按键 → 动作（输入框焦点下生效；文本编辑键不拦截） */
export function quickKeyAction(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): QuickAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "Escape":
      return "escape";
    case "Enter":
      if (e.altKey) return "locate";
      if (ctrl) return "reveal";
      return "launch";
    default:
      break;
  }
  if (ctrl && !e.altKey && (e.key === "t" || e.key === "T") && !e.shiftKey) return "tag";
  if (ctrl && e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) return "copy";
  return null;
}

/** 循环移动选中行 */
export function stepIndex(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** 切换对象上的某个标签，返回新的标签 ID 列表（保持原顺序，新标签追加在末尾） */
export function toggledTagIds(item: Pick<ItemWithTags, "tags">, tagId: number): number[] {
  const ids = item.tags.map((tag) => tag.id);
  return ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId];
}

/** 标签选择器的过滤：名称包含（不分大小写），已在对象上的排前面 */
export function filterTagChoices<T extends { id: number; name: string }>(
  tags: T[],
  query: string,
  activeIds: ReadonlySet<number>,
): T[] {
  const q = query.trim().toLowerCase();
  const matched = q ? tags.filter((tag) => tag.name.toLowerCase().includes(q)) : tags;
  return [...matched.filter((t) => activeIds.has(t.id)), ...matched.filter((t) => !activeIds.has(t.id))];
}

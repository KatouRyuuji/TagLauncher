// ============================================================================
// lib/tagFilter.ts — 按标签筛选对象（侧栏正选/反选，含层级后代展开）
// ============================================================================
// 文本搜索在后端（src-tauri/src/search）；这里只做浏览视图的标签筛选，
// 主窗搜索时把筛选结果的 ID 作为范围交给后端。
// ============================================================================

import type { ItemWithTags } from "../types";

/**
 * 按标签筛选：正选为 AND 交集，反选为排除（命中任一反选标签即剔除）。
 * 传入 `expand` 时支持图状层级：每个正选标签的命中条件 = 对象拥有 {该标签 ∪ 其后代} 中任一标签
 * （选中父标签即并入所有后代对象）；反选对称地走同一后代闭包（排除父标签同时排除后代对象）。
 * 不传 `expand` 时退化为精确标签匹配（仅直接标签，不把祖先写入 item_tags）。
 */
export function expandForTagFilter(
  includeDescendants: boolean,
  descendantsMap: Map<number, Set<number>>,
): ((tagId: number) => Set<number>) | undefined {
  if (!includeDescendants) return undefined;
  return (id) => descendantsMap.get(id) ?? new Set([id]);
}

export function filterItemsByTags(
  items: ItemWithTags[],
  selectedTagIds: number[],
  expand?: (tagId: number) => Set<number>,
  excludedTagIds: number[] = [],
): ItemWithTags[] {
  if (selectedTagIds.length === 0 && excludedTagIds.length === 0) return items;
  const matches = (item: ItemWithTags, tid: number) => {
    const allowed = expand ? expand(tid) : null;
    return allowed
      ? item.tags.some((t) => allowed.has(t.id))
      : item.tags.some((t) => t.id === tid);
  };
  return items.filter((item) =>
    selectedTagIds.every((tid) => matches(item, tid)) &&
    !excludedTagIds.some((tid) => matches(item, tid)),
  );
}

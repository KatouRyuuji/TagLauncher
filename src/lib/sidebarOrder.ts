// ============================================================================
// lib/sidebarOrder.ts — 侧栏标签与文件柜的手动顺序
// ============================================================================
// sort_order 升序在前；相同值（含从未拖动过的 0）交给调用方的默认规则。
// 拖动后把整列当前顺序写回后端，后续各处按同一顺序显示。
// ============================================================================

/** 手动顺序升序，缺省视为 0；相同值返回 0，调用方再接默认规则 */
export function compareSortOrder(a: { sort_order?: number }, b: { sort_order?: number }): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/** 把 id 移到 targetId 之前（after 为真时之后），返回新顺序；任一不在列表或两者相同时返回 null */
export function moveBeside(ids: number[], id: number, targetId: number, after: boolean): number[] | null {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return null;
  const next = ids.filter((value) => value !== id);
  const at = next.indexOf(targetId) + (after ? 1 : 0);
  next.splice(at, 0, id);
  return next;
}

/** 按新顺序回填 sort_order（1 起），与后端 reorder 写入的值一致 */
export function applySortOrder<T extends { id: number; sort_order?: number }>(list: T[], ids: number[]): T[] {
  const rank = new Map(ids.map((id, index) => [id, index + 1]));
  return list
    .map((entry) => (rank.has(entry.id) ? { ...entry, sort_order: rank.get(entry.id) } : entry))
    .sort(compareSortOrder);
}

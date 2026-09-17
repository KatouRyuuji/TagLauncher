// ============================================================================
// lib/tagOwnership.ts — 选中对象对某个标签的拥有计数
// ============================================================================
// 批量「加入 / 移除标签」菜单要区分：全部已有（实心勾）、部分已有（k/N）、都没有（空）。
// selectedItemIds 在 App 本地 state，不在 Zustand；本函数只吃已经解析好的选中对象。
// ============================================================================

export interface TagOwnership {
  have: number;
  total: number;
}

export interface TaggableItem {
  tags: Array<{ id: number }>;
}

/** 选中对象里有多少个已经挂着 tagId。total = 选中数；都没有则 have = 0。 */
export function summarizeTagOwnership(selectedItems: TaggableItem[], tagId: number): TagOwnership {
  const total = selectedItems.length;
  let have = 0;
  for (const item of selectedItems) {
    if (item.tags.some((tag) => tag.id === tagId)) have += 1;
  }
  return { have, total };
}

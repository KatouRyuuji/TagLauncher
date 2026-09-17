// ============================================================================
// lib/tagTree.ts — 侧栏标签 DAG 展平（最多两级浅缩进）
// ============================================================================
// 把多继承 DAG 收成一条不重复的侧栏行序：根按调用方 order 排，子紧跟父，
// 深度封顶 2。筛选闭包仍由 filterItemsByTags / buildDescendantsMap 负责，
// 这里只负责「让关系在侧栏上看得见」，不改计数语义、不做折叠。
// ============================================================================

import type { TagRelation } from "../types";
import { buildChildrenMap, buildParentsMap } from "./tagGraph";

export interface TagTreeRow<T extends { id: number }> {
  tag: T;
  depth: 0 | 1 | 2;
  hasChildren: boolean;
}

/**
 * 把标签 DAG 展平成侧栏行序：根（无父）按 order 排，子紧跟父后面缩进一级，最多两级（更深的压到 depth 2）。
 * 多父标签只在**首个遇到的父**下出现一次（侧栏不重复列行）；环（不应存在）用 visited 防死循环。
 * 同一层内仍用调用方给的 order（侧栏现在是按计数降序）。
 */
export function flattenTagTree<T extends { id: number }>(
  tags: T[],
  relations: TagRelation[],
  order: (a: T, b: T) => number,
): TagTreeRow<T>[] {
  if (tags.length === 0) return [];

  const byId = new Map<number, T>();
  for (const tag of tags) byId.set(tag.id, tag);

  const childrenMap = buildChildrenMap(relations);
  const parentsMap = buildParentsMap(relations);

  const isRoot = (tag: T): boolean => {
    const parents = parentsMap.get(tag.id);
    if (!parents || parents.length === 0) return true;
    // 父不在当前 tags 列表里：当作根，避免子标签被悄悄丢掉
    return parents.every((parentId) => !byId.has(parentId));
  };

  const visibleChildren = (id: number): T[] => {
    const childIds = childrenMap.get(id);
    if (!childIds || childIds.length === 0) return [];
    const children: T[] = [];
    for (const childId of childIds) {
      const child = byId.get(childId);
      if (child) children.push(child);
    }
    return children.sort(order);
  };

  const hasChildren = (id: number): boolean => {
    const childIds = childrenMap.get(id);
    if (!childIds) return false;
    return childIds.some((childId) => byId.has(childId));
  };

  const visited = new Set<number>();
  const rows: TagTreeRow<T>[] = [];

  const walk = (tag: T, depth: 0 | 1 | 2): void => {
    if (visited.has(tag.id)) return;
    visited.add(tag.id);
    rows.push({ tag, depth, hasChildren: hasChildren(tag.id) });
    const nextDepth: 0 | 1 | 2 = depth === 0 ? 1 : 2;
    for (const child of visibleChildren(tag.id)) {
      walk(child, nextDepth);
    }
  };

  for (const tag of tags.filter(isRoot).sort(order)) {
    walk(tag, 0);
  }

  // 环或异常数据可能没有「无父根」；剩余节点仍按 order 以根列出，避免侧栏丢行
  if (visited.size < tags.length) {
    for (const tag of [...tags].sort(order)) {
      if (!visited.has(tag.id)) walk(tag, 0);
    }
  }

  return rows;
}

// ============================================================================
// lib/tagTree.ts — 侧栏标签 DAG 展平（最多两级浅缩进）
// ============================================================================
// 把多继承 DAG 收成侧栏行序：根按调用方 order 排，子紧跟父，深度封顶 2。
// 默认按「完整路径出现」重复列出多父标签（A→C←B 展开后两支都显示 C）。
// 打标器 / 关系编辑器传 uniqueIds，保持「每个 tag id 一行」，避免把选择面扩成路径。
// 筛选闭包仍由 filterItemsByTags / buildDescendantsMap 负责；计数、选标签仍按 tag id。
// ============================================================================

import type { TagRelation } from "../types";
import { buildChildrenMap, buildParentsMap } from "./tagGraph";

export interface TagTreeRow<T extends { id: number }> {
  tag: T;
  depth: 0 | 1 | 2;
  hasChildren: boolean;
  /** 本行所在的父标签；根为 null */
  parentId: number | null;
  /** 本行出现身份：根到此节点的 tag id 路径，用于折叠与 React key，避免 parentId+tagId 碰撞 */
  pathKey: string;
}

export interface FlattenTagTreeOptions {
  /**
   * true：每个 tag id 只出现一次（首个遇到的父下），供打标器 / 关系编辑器。
   * false（默认）：多父按路径重复列出，供侧栏。
   */
  uniqueIds?: boolean;
}

function pathKeyOf(path: readonly number[], tagId: number): string {
  return path.length === 0 ? String(tagId) : `${path.join("/")}/${tagId}`;
}

/**
 * 把标签 DAG 展平成侧栏行序：根（无父）按 order 排，子紧跟父后面缩进一级，最多两级（更深的压到 depth 2）。
 * 默认多父标签在每个父下各出现一次；环用当前路径防死循环。同一层内用调用方给的 order。
 */
export function flattenTagTree<T extends { id: number }>(
  tags: T[],
  relations: TagRelation[],
  order: (a: T, b: T) => number,
  options: FlattenTagTreeOptions = {},
): TagTreeRow<T>[] {
  if (tags.length === 0) return [];

  const uniqueIds = options.uniqueIds === true;
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

  const visitedIds = new Set<number>();
  const emittedPaths = new Set<string>();
  const rows: TagTreeRow<T>[] = [];

  const walk = (tag: T, depth: 0 | 1 | 2, parentId: number | null, path: number[]): void => {
    if (path.includes(tag.id)) return;
    if (uniqueIds && visitedIds.has(tag.id)) return;
    const pathKey = pathKeyOf(path, tag.id);
    if (emittedPaths.has(pathKey)) return;
    emittedPaths.add(pathKey);
    visitedIds.add(tag.id);
    rows.push({ tag, depth, hasChildren: hasChildren(tag.id), parentId, pathKey });
    const nextDepth: 0 | 1 | 2 = depth === 0 ? 1 : 2;
    const nextPath = [...path, tag.id];
    for (const child of visibleChildren(tag.id)) {
      walk(child, nextDepth, tag.id, nextPath);
    }
  };

  for (const tag of tags.filter(isRoot).sort(order)) {
    walk(tag, 0, null, []);
  }

  // 环或异常数据可能没有「无父根」；尚未出现过的节点仍按 order 以根列出，避免侧栏丢行
  if (visitedIds.size < tags.length) {
    for (const tag of [...tags].sort(order)) {
      if (!visitedIds.has(tag.id)) walk(tag, 0, null, []);
    }
  }

  return rows;
}

/** 按路径折叠：折起 A 不影响 B 路径上的同一子标签。 */
export function filterCollapsedTagRows<T extends { id: number }>(
  rows: TagTreeRow<T>[],
  collapsedPathKeys: ReadonlySet<string>,
): TagTreeRow<T>[] {
  const visible: TagTreeRow<T>[] = [];
  const ancestorKeys: string[] = [];
  for (const row of rows) {
    const hidden = ancestorKeys.slice(0, row.depth).some((key) => collapsedPathKeys.has(key));
    ancestorKeys.length = row.depth;
    ancestorKeys[row.depth] = row.pathKey;
    if (!hidden) visible.push(row);
  }
  return visible;
}

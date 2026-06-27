// ============================================================================
// lib/tagGraph.ts — 标签 DAG（图状层级）计算工具
// ============================================================================
// 标签是集合，父标签是子标签的超集，可多继承（一个标签可有多个父）。
// 这里提供：邻接表构建、后代闭包（用于按父标签并入后代对象筛选）、分层布局（用于关系图视图）。
// 后端已保证关系无环，这里的递归仍带访问栈兜底以防御异常数据。
// ============================================================================

import type { TagRelation } from "../types";

/** 父 → 直接子 邻接表 */
export function buildChildrenMap(relations: TagRelation[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const { parentId, childId } of relations) {
    const arr = map.get(parentId);
    if (arr) arr.push(childId);
    else map.set(parentId, [childId]);
  }
  return map;
}

/** 子 → 直接父 邻接表 */
export function buildParentsMap(relations: TagRelation[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const { parentId, childId } of relations) {
    const arr = map.get(childId);
    if (arr) arr.push(parentId);
    else map.set(childId, [parentId]);
  }
  return map;
}

/**
 * 为每个出现在关系中的标签计算「自身 + 所有后代」闭包集合。
 * 用于按父标签筛选时并入后代对象。未出现在任何关系里的标签由调用方回退为 {自身}。
 */
export function buildDescendantsMap(relations: TagRelation[]): Map<number, Set<number>> {
  const children = buildChildrenMap(relations);
  const cache = new Map<number, Set<number>>();

  const collect = (id: number, stack: Set<number>): Set<number> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const result = new Set<number>([id]);
    if (!stack.has(id)) {
      stack.add(id);
      for (const child of children.get(id) ?? []) {
        for (const d of collect(child, stack)) result.add(d);
      }
      stack.delete(id);
    }
    cache.set(id, result);
    return result;
  };

  const nodes = new Set<number>();
  for (const { parentId, childId } of relations) {
    nodes.add(parentId);
    nodes.add(childId);
  }
  for (const id of nodes) collect(id, new Set());
  return cache;
}

/**
 * 为 DAG 节点计算层级（最长路径深度）：无父节点为第 0 层，
 * 子节点层级 = max(父层级) + 1。用于关系图分层绘制。
 */
export function computeLayers(nodeIds: number[], relations: TagRelation[]): Map<number, number> {
  const parents = buildParentsMap(relations);
  const layer = new Map<number, number>();
  const visiting = new Set<number>();

  const depth = (id: number): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // 环兜底
    visiting.add(id);
    let d = 0;
    for (const p of parents.get(id) ?? []) {
      d = Math.max(d, depth(p) + 1);
    }
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };

  for (const id of nodeIds) depth(id);
  return layer;
}

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
    // 环兜底：当前访问路径上再次遇到自身，返回 {自身} 但不写缓存，
    // 避免把"因成环而提前截断的不完整后代集"污染进缓存（后端已保证无环，仅防御）。
    if (stack.has(id)) return new Set<number>([id]);

    const result = new Set<number>([id]);
    stack.add(id);
    for (const child of children.get(id) ?? []) {
      for (const d of collect(child, stack)) result.add(d);
    }
    stack.delete(id);
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
 * 对 DAG 分层结果做层内 barycenter（重心）排序，减少层间连边交叉。
 * 保持层级不变，只重排每层内节点的水平顺序。
 * 算法：多轮自上而下 + 自下而上迭代，每轮按相邻层邻居的平均索引计算重心，
 * 重心小的排在左侧。重心相同时保持输入顺序（稳定）。
 */
export function orderLayersByBarycenter(
  layers: number[][],
  relations: TagRelation[],
  iterations = 3,
): number[][] {
  if (layers.length === 0) return [];
  const parents = buildParentsMap(relations);
  const children = buildChildrenMap(relations);

  // 深拷贝，避免 mutate 输入
  const ordered = layers.map((layer) => [...layer]);

  const avg = (values: number[]): number => {
    if (values.length === 0) return -1;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  // 当前节点在指定层中的索引
  const posOf = new Map<number, number>();
  const rebuildPos = () => {
    posOf.clear();
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered[i].length; j++) {
        posOf.set(ordered[i][j], j);
      }
    }
  };
  rebuildPos();

  for (let iter = 0; iter < iterations; iter++) {
    // 自上而下：用上一层父节点索引的重心排序当前层
    for (let i = 1; i < ordered.length; i++) {
      ordered[i].sort((a, b) => {
        const ca = avg((parents.get(a) ?? []).map((p) => posOf.get(p) ?? -1).filter((v) => v >= 0));
        const cb = avg((parents.get(b) ?? []).map((p) => posOf.get(p) ?? -1).filter((v) => v >= 0));
        if (ca === cb) return 0;
        return ca - cb;
      });
      rebuildPos();
    }

    // 自下而上：用下一层子节点索引的重心排序当前层
    for (let i = ordered.length - 2; i >= 0; i--) {
      ordered[i].sort((a, b) => {
        const ca = avg((children.get(a) ?? []).map((c) => posOf.get(c) ?? -1).filter((v) => v >= 0));
        const cb = avg((children.get(b) ?? []).map((c) => posOf.get(c) ?? -1).filter((v) => v >= 0));
        if (ca === cb) return 0;
        return ca - cb;
      });
      rebuildPos();
    }
  }

  return ordered;
}
// ── 图谱空态语义 ────────────────────────────────────────────────────────────
// 「没有标签」和「有标签但没建过关系」是两种语义不同的空态：
//   no-tags      — 图谱无从谈起，引导先创建标签；
//   no-relations — 节点可以画但没有层级信息，引导到「标签关系」建立父子关系；
//   null         — 有节点也有边，正常渲染图谱。

export type TagGraphEmptyState = "no-tags" | "no-relations" | null;

/** 根据标签数与（端点均存在的）关系数解析图谱空态语义。 */
export function resolveTagGraphEmptyState(tagCount: number, relationCount: number): TagGraphEmptyState {
  if (tagCount <= 0) return "no-tags";
  if (relationCount <= 0) return "no-relations";
  return null;
}

/**
 * 图谱打开时的默认选中：直接子节点最多的标签。
 * 只统计两端都在 tagIds 内的关系（与视图里的 validRelations 一致）；
 * 平局取 id 较小者；没有任何可用关系时返回 null。
 */
export function pickDefaultGraphNode(tagIds: number[], relations: TagRelation[]): number | null {
  if (tagIds.length === 0 || relations.length === 0) return null;

  const allowed = new Set(tagIds);
  const childCount = new Map<number, number>();
  for (const { parentId, childId } of relations) {
    if (!allowed.has(parentId) || !allowed.has(childId)) continue;
    childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
  }

  let bestId: number | null = null;
  let bestCount = 0;
  for (const [id, count] of childCount) {
    if (count > bestCount || (count === bestCount && count > 0 && (bestId === null || id < bestId))) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestCount > 0 ? bestId : null;
}

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

export type GraphNodeRelation = "selected" | "parent" | "child" | "descendant";

export interface GraphHighlight {
  /** 节点 → 与选中标签的关系；不在表内的节点淡化 */
  nodes: Map<number, GraphNodeRelation>;
  /** 需高亮的连线（`${parentId}-${childId}`）：选中与直接父之间 + 选中整棵后代子树内的边 */
  edges: Set<string>;
  /** 后代数（不含自身） */
  descendantCount: number;
}

/**
 * 图谱选中高亮（F06）：除一层父/子外，高亮该标签的**全部后代**及子树内连线，
 * 便于看清一个父标签筛选时会并入哪些标签。父方向只取直接父（祖先链不展开，避免整图变亮）。
 */
export function buildGraphHighlight(selectedId: number, relations: TagRelation[]): GraphHighlight {
  const descendants = buildDescendantsMap(relations).get(selectedId) ?? new Set<number>([selectedId]);
  const nodes = new Map<number, GraphNodeRelation>([[selectedId, "selected"]]);
  const edges = new Set<string>();
  for (const { parentId, childId } of relations) {
    if (childId === selectedId) {
      if (!nodes.has(parentId)) nodes.set(parentId, "parent");
      edges.add(`${parentId}-${childId}`);
    }
    if (descendants.has(parentId) && descendants.has(childId) && childId !== selectedId) {
      edges.add(`${parentId}-${childId}`);
    }
  }
  for (const id of descendants) {
    if (id === selectedId) continue;
    const direct = relations.some((r) => r.parentId === selectedId && r.childId === id);
    nodes.set(id, direct ? "child" : "descendant");
  }
  return { nodes, edges, descendantCount: descendants.size - 1 };
}

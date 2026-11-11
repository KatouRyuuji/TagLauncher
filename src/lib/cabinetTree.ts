// ============================================================================
// lib/cabinetTree.ts — 文件柜嵌套（F16 方案 C）的纯函数
// ============================================================================
// 单父树：parent_id 为 null 或指向不存在的柜时按顶层处理；同级保持传入顺序
// （即 get_cabinets 的 sort_order、名称）。外部写出的环不会导致死循环：
// 环上的柜在遍历结束后按顶层补出。
// ============================================================================

import type { Cabinet } from "../types";

export interface CabinetTreeRow {
  cabinet: Cabinet;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

function parentOf(cabinet: Cabinet, ids: Set<number>): number | null {
  const parent = cabinet.parent_id ?? null;
  return parent !== null && ids.has(parent) && parent !== cabinet.id ? parent : null;
}

function childrenMap(cabinets: Cabinet[]): Map<number | null, Cabinet[]> {
  const ids = new Set(cabinets.map((c) => c.id));
  const map = new Map<number | null, Cabinet[]>();
  for (const cabinet of cabinets) {
    const key = parentOf(cabinet, ids);
    const list = map.get(key);
    if (list) list.push(cabinet);
    else map.set(key, [cabinet]);
  }
  return map;
}

/** 深度优先展开为侧栏行；折叠的柜不展开其子孙。 */
export function flattenCabinetTree(cabinets: Cabinet[], collapsed: ReadonlySet<number> = new Set()): CabinetTreeRow[] {
  const children = childrenMap(cabinets);
  const rows: CabinetTreeRow[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number, hidden: boolean) => {
    for (const cabinet of children.get(parent) ?? []) {
      if (seen.has(cabinet.id)) continue;
      seen.add(cabinet.id);
      const hasChildren = (children.get(cabinet.id)?.length ?? 0) > 0;
      const isCollapsed = hasChildren && collapsed.has(cabinet.id);
      if (!hidden) rows.push({ cabinet, depth, hasChildren, collapsed: isCollapsed });
      walk(cabinet.id, depth + 1, hidden || isCollapsed);
    }
  };
  walk(null, 0, false);
  for (const cabinet of cabinets) {
    if (!seen.has(cabinet.id)) rows.push({ cabinet, depth: 0, hasChildren: false, collapsed: false });
  }
  return rows;
}

/** `id` 的全部子孙柜 id（不含自身）。 */
export function cabinetDescendants(cabinets: Cabinet[], id: number): Set<number> {
  const children = childrenMap(cabinets);
  const out = new Set<number>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next.id === id || out.has(next.id)) continue;
    out.add(next.id);
    stack.push(...(children.get(next.id) ?? []));
  }
  return out;
}

export function hasChildCabinets(cabinets: Cabinet[], id: number): boolean {
  return cabinets.some((c) => c.parent_id === id && c.id !== id);
}

/** 「父 / 子」形式的路径名，用于下拉框与收纳选项。 */
export function cabinetPathLabel(
  cabinets: ReadonlyArray<{ id: number; name: string; parent_id?: number | null }>,
  id: number,
): string {
  const byId = new Map(cabinets.map((c) => [c.id, c]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
}

/** `id` 可选的父柜：排除自身、自己的子孙（防环）与关联文件夹柜（只能是叶子）。 */
export function parentCandidates(cabinets: Cabinet[], id: number | null): Cabinet[] {
  const banned = id === null ? new Set<number>() : new Set([id, ...cabinetDescendants(cabinets, id)]);
  return cabinets.filter((c) => !banned.has(c.id) && !c.folder_path);
}

/** 拖放校验：把 `id` 放进 `parent`（null = 顶层）是否合法。 */
export function canNestCabinet(cabinets: Cabinet[], id: number, parent: number | null): boolean {
  if (parent === null) return true;
  return parentCandidates(cabinets, id).some((c) => c.id === parent);
}

// lib/tagHierarchyDrag.ts — 侧栏「编辑层级」拖动的落点语义（F14，纯逻辑）
//
// 标签关系是 DAG（多父）。侧栏按路径展示（F12：共享子标签在每个父级下各出现一次），
// 所以被拖的那一行自带「从哪个父级拖出来」（sourceParentId，顶层为 null）。
// - 拖到标签 P 上：默认「加为 P 的子标签」= 加边，保留原有父级（多父）；
// - 按住 Alt 放下：「从当前父级移到 P 下」= 换边（删 sourceParent→T，加 P→T）；
// - 拖到顶部「移到顶层」区：只删 sourceParent→T（仍有其他父级时它留在那些父级下）。
// 防环与后端 move_tag_parent 同口径：P 不能是 T 自身或 T 的后代。
import type { TagRelation } from "../types";

export interface TagParentChange {
  childId: number;
  fromParentId: number | null;
  toParentId: number | null;
}

export type HierarchyDropTarget = { kind: "parent"; parentId: number; move: boolean } | { kind: "root" };

export type HierarchyDropResult = { ok: true; change: TagParentChange } | { ok: false; reason: string };

/** tagId 的全部后代（不含自身） */
export function descendantIds(tagId: number, relations: readonly TagRelation[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const rel of relations) {
    const list = children.get(rel.parentId);
    if (list) list.push(rel.childId);
    else children.set(rel.parentId, [rel.childId]);
  }
  const out = new Set<number>();
  const stack = [...(children.get(tagId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export function resolveHierarchyDrop(
  tagId: number,
  sourceParentId: number | null,
  target: HierarchyDropTarget,
  relations: readonly TagRelation[],
): HierarchyDropResult {
  if (target.kind === "root") {
    if (sourceParentId === null) return { ok: false, reason: "已在顶层" };
    return { ok: true, change: { childId: tagId, fromParentId: sourceParentId, toParentId: null } };
  }
  const parentId = target.parentId;
  if (parentId === tagId) return { ok: false, reason: "不能拖到自身" };
  if (descendantIds(tagId, relations).has(parentId)) return { ok: false, reason: "目标是它的下级标签，会形成循环" };
  const alreadyChild = relations.some((rel) => rel.parentId === parentId && rel.childId === tagId);
  const move = target.move && sourceParentId !== null && sourceParentId !== parentId;
  if (alreadyChild && !move) return { ok: false, reason: "已是它的下级标签" };
  return { ok: true, change: { childId: tagId, fromParentId: move ? sourceParentId : null, toParentId: parentId } };
}

/** 成功后的提示文案 */
export function describeParentChange(change: TagParentChange, nameOf: (id: number) => string): string {
  const child = `「${nameOf(change.childId)}」`;
  if (change.toParentId === null) return `已把${child}移出「${nameOf(change.fromParentId!)}」`;
  if (change.fromParentId === null) return `已把${child}加到「${nameOf(change.toParentId)}」下（保留原有父级）`;
  return `已把${child}从「${nameOf(change.fromParentId)}」移到「${nameOf(change.toParentId)}」下`;
}

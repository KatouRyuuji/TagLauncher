// lib/tagScopeSearch.ts — 标签过滤的「当前层 + 下级」范围（F04c，纯逻辑）
//
// 「当前层」= 侧栏已选的正向标签（用户正在浏览的那几支）。有当前层且输入了过滤词时：
// 1. 先只在当前层及其全部下级里找（下级闭包与筛选「含下级」同一口径：沿 tag_relations 的全部后代）；
// 2. 当前层里没有命中、全部标签里有时，给出「全部标签中有 N 个」并可一键转全局；
// 3. 用户主动转全局后，同一过滤词保持全局，直到清空过滤词或当前层变化。
// 名称匹配仍用 matchesNameQuery（子串 + 拼音全拼/首字母前缀），与侧栏既有过滤同一规则。
import type { TagRelation } from "../types";
import type { TagTreeRow } from "./tagTree";

export type TagSearchScope = "all" | "subtree" | "global";

export interface ScopedTagSearch<T extends { id: number }> {
  rows: TagTreeRow<T>[];
  /** all：没有过滤词或没有当前层；subtree：只在当前层；global：在全部标签中 */
  scope: TagSearchScope;
  /** 当前层内的命中数（按 tag id 去重） */
  subtreeCount: number;
  /** 全部标签中的命中数（按 tag id 去重） */
  globalCount: number;
}

/** roots ∪ 全部后代 */
export function subtreeIds(roots: readonly number[], relations: readonly TagRelation[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const rel of relations) {
    const list = children.get(rel.parentId);
    if (list) list.push(rel.childId);
    else children.set(rel.parentId, [rel.childId]);
  }
  const out = new Set<number>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

function distinctCount<T extends { id: number }>(rows: readonly TagTreeRow<T>[]): number {
  return new Set(rows.map((row) => row.tag.id)).size;
}

export function scopedTagSearch<T extends { id: number; name: string }>(
  rows: readonly TagTreeRow<T>[],
  relations: readonly TagRelation[],
  roots: readonly number[],
  query: string,
  matches: (name: string) => boolean,
  forceGlobal: boolean,
  /** true：行按 tag id 去重（打标器），子树判断只看标签本身 */
  uniqueRows = false,
): ScopedTagSearch<T> {
  if (!query.trim()) return { rows: [...rows], scope: "all", subtreeCount: 0, globalCount: 0 };
  const hits = rows.filter((row) => matches(row.tag.name));
  const globalCount = distinctCount(hits);
  if (roots.length === 0) return { rows: hits, scope: "all", subtreeCount: globalCount, globalCount };
  const inside = subtreeIds(roots, relations);
  // 只保留走在当前层里的路径：本行标签在子树内，且它是当前层根或父级也在子树内（多父标签在子树外的那条路径不算）
  const scoped = hits.filter(
    (row) => inside.has(row.tag.id)
      && (uniqueRows || roots.includes(row.tag.id) || (row.parentId !== null && inside.has(row.parentId))),
  );
  const subtreeCount = distinctCount(scoped);
  if (forceGlobal) return { rows: hits, scope: "global", subtreeCount, globalCount };
  return { rows: scoped, scope: "subtree", subtreeCount, globalCount };
}

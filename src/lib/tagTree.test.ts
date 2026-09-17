import { assert, test, run } from "./__testutil";
import { flattenTagTree } from "./tagTree";
import type { TagRelation } from "../types";

function tag(id: number): { id: number } {
  return { id };
}

function rel(parentId: number, childId: number): TagRelation {
  return { parentId, childId };
}

function byId(a: { id: number }, b: { id: number }): number {
  return a.id - b.id;
}

function snapshot(tags: { id: number }[], relations: TagRelation[], order = byId) {
  return flattenTagTree(tags, relations, order).map((row) => ({
    id: row.tag.id,
    depth: row.depth,
    hasChildren: row.hasChildren,
  }));
}

test("flattenTagTree：无关系时全为 depth 0，顺序跟调用方 order", () => {
  assert.deepEqual(snapshot([tag(3), tag(1), tag(2)], []), [
    { id: 1, depth: 0, hasChildren: false },
    { id: 2, depth: 0, hasChildren: false },
    { id: 3, depth: 0, hasChildren: false },
  ]);
});

test("flattenTagTree：一级父子，子紧跟父且 depth 1", () => {
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3)], [rel(1, 2)]), [
    { id: 1, depth: 0, hasChildren: true },
    { id: 2, depth: 1, hasChildren: false },
    { id: 3, depth: 0, hasChildren: false },
  ]);
});

test("flattenTagTree：三代压到 depth 2，更深不再加缩进", () => {
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3), tag(4)], [rel(1, 2), rel(2, 3), rel(3, 4)]), [
    { id: 1, depth: 0, hasChildren: true },
    { id: 2, depth: 1, hasChildren: true },
    { id: 3, depth: 2, hasChildren: true },
    { id: 4, depth: 2, hasChildren: false },
  ]);
});

test("flattenTagTree：多父只在首个遇到的父下出现一次", () => {
  // 根按 id 升序：先走 1 再走 2，3 只挂在 1 下；2 仍标 hasChildren（筛选会并入）
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3)], [rel(1, 3), rel(2, 3)]), [
    { id: 1, depth: 0, hasChildren: true },
    { id: 3, depth: 1, hasChildren: false },
    { id: 2, depth: 0, hasChildren: true },
  ]);
});

test("flattenTagTree：孤立子（父不在 tags 列表里）当根", () => {
  assert.deepEqual(snapshot([tag(1), tag(3)], [rel(2, 3)]), [
    { id: 1, depth: 0, hasChildren: false },
    { id: 3, depth: 0, hasChildren: false },
  ]);
});

test("flattenTagTree：同一层子节点按调用方 order 排", () => {
  const order = (a: { id: number }, b: { id: number }) => b.id - a.id;
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3)], [rel(1, 2), rel(1, 3)], order), [
    { id: 1, depth: 0, hasChildren: true },
    { id: 3, depth: 1, hasChildren: false },
    { id: 2, depth: 1, hasChildren: false },
  ]);
});

test("flattenTagTree：环用 visited 防死循环，节点仍各出现一次", () => {
  const rows = snapshot([tag(1), tag(2)], [rel(1, 2), rel(2, 1)]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id).sort((a, b) => a - b), [1, 2]);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2);
});

await run("tagTree");

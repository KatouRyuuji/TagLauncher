import { assert, test, run } from "./__testutil";
import { filterCollapsedTagRows, flattenTagTree } from "./tagTree";
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

function snapshot(
  tags: { id: number }[],
  relations: TagRelation[],
  order = byId,
  uniqueIds = false,
) {
  return flattenTagTree(tags, relations, order, { uniqueIds }).map((row) => ({
    id: row.tag.id,
    depth: row.depth,
    hasChildren: row.hasChildren,
    parentId: row.parentId,
    pathKey: row.pathKey,
  }));
}

test("flattenTagTree：无关系时全为 depth 0，顺序跟调用方 order", () => {
  assert.deepEqual(snapshot([tag(3), tag(1), tag(2)], []), [
    { id: 1, depth: 0, hasChildren: false, parentId: null, pathKey: "1" },
    { id: 2, depth: 0, hasChildren: false, parentId: null, pathKey: "2" },
    { id: 3, depth: 0, hasChildren: false, parentId: null, pathKey: "3" },
  ]);
});

test("flattenTagTree：一级父子，子紧跟父且 depth 1", () => {
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3)], [rel(1, 2)]), [
    { id: 1, depth: 0, hasChildren: true, parentId: null, pathKey: "1" },
    { id: 2, depth: 1, hasChildren: false, parentId: 1, pathKey: "1/2" },
    { id: 3, depth: 0, hasChildren: false, parentId: null, pathKey: "3" },
  ]);
});

test("flattenTagTree：三代压到 depth 2，更深不再加缩进", () => {
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3), tag(4)], [rel(1, 2), rel(2, 3), rel(3, 4)]), [
    { id: 1, depth: 0, hasChildren: true, parentId: null, pathKey: "1" },
    { id: 2, depth: 1, hasChildren: true, parentId: 1, pathKey: "1/2" },
    { id: 3, depth: 2, hasChildren: true, parentId: 2, pathKey: "1/2/3" },
    { id: 4, depth: 2, hasChildren: false, parentId: 3, pathKey: "1/2/3/4" },
  ]);
});

test("flattenTagTree：多父默认在两支下都出现，行身份是完整路径", () => {
  const rows = snapshot([tag(1), tag(2), tag(3)], [rel(1, 3), rel(2, 3)]);
  assert.deepEqual(rows, [
    { id: 1, depth: 0, hasChildren: true, parentId: null, pathKey: "1" },
    { id: 3, depth: 1, hasChildren: false, parentId: 1, pathKey: "1/3" },
    { id: 2, depth: 0, hasChildren: true, parentId: null, pathKey: "2" },
    { id: 3, depth: 1, hasChildren: false, parentId: 2, pathKey: "2/3" },
  ]);
  assert.equal(new Set(rows.map((row) => row.pathKey)).size, 4);
});

test("flattenTagTree：uniqueIds 时多父只在首个遇到的父下出现一次（打标器）", () => {
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3)], [rel(1, 3), rel(2, 3)], byId, true), [
    { id: 1, depth: 0, hasChildren: true, parentId: null, pathKey: "1" },
    { id: 3, depth: 1, hasChildren: false, parentId: 1, pathKey: "1/3" },
    { id: 2, depth: 0, hasChildren: true, parentId: null, pathKey: "2" },
  ]);
});

test("flattenTagTree：深层钻石 A→B→D、A→C→D、E→D 三支都能展开", () => {
  const rows = snapshot(
    [tag(1), tag(2), tag(3), tag(4), tag(5)],
    [rel(1, 2), rel(1, 3), rel(2, 4), rel(3, 4), rel(5, 4)],
  );
  const dRows = rows.filter((row) => row.id === 4);
  assert.equal(dRows.length, 3);
  assert.deepEqual(dRows.map((row) => row.pathKey).sort(), ["1/2/4", "1/3/4", "5/4"].sort());
});

test("flattenTagTree：孤立子（父不在 tags 列表里）当根", () => {
  assert.deepEqual(snapshot([tag(1), tag(3)], [rel(2, 3)]), [
    { id: 1, depth: 0, hasChildren: false, parentId: null, pathKey: "1" },
    { id: 3, depth: 0, hasChildren: false, parentId: null, pathKey: "3" },
  ]);
});

test("flattenTagTree：同一层子节点按调用方 order 排（仍是全局同级顺序，不是每父一份排序）", () => {
  const order = (a: { id: number }, b: { id: number }) => b.id - a.id;
  assert.deepEqual(snapshot([tag(1), tag(2), tag(3)], [rel(1, 2), rel(1, 3)], order), [
    { id: 1, depth: 0, hasChildren: true, parentId: null, pathKey: "1" },
    { id: 3, depth: 1, hasChildren: false, parentId: 1, pathKey: "1/3" },
    { id: 2, depth: 1, hasChildren: false, parentId: 1, pathKey: "1/2" },
  ]);
});

test("flattenTagTree：环用路径防死循环，节点仍能列出", () => {
  const rows = snapshot([tag(1), tag(2)], [rel(1, 2), rel(2, 1)]);
  assert.ok(rows.length >= 2);
  assert.deepEqual([...new Set(rows.map((row) => row.id))].sort((a, b) => a - b), [1, 2]);
});

test("filterCollapsedTagRows：折叠 A 不影响 B 路径上的 C", () => {
  const rows = flattenTagTree([tag(1), tag(2), tag(3)], [rel(1, 3), rel(2, 3)], byId);
  const collapsed = filterCollapsedTagRows(rows, new Set(["1"]));
  assert.deepEqual(
    collapsed.map((row) => row.pathKey),
    ["1", "2", "2/3"],
  );
});

await run("tagTree");

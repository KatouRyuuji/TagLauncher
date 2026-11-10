// ============================================================================
// lib/tagFilter.design.test.ts — 标签筛选回归（正选/反选、层级后代展开）
// ============================================================================
// 文本搜索的设计回归已移植到 src-tauri/src/search/design_tests.rs。
// ============================================================================
import { assert, test, run } from "./__testutil";
import { filterItemsByTags } from "./tagFilter";
import { buildDescendantsMap } from "./tagGraph";
import type { ItemWithTags } from "../types";

function item(id: number, name: string, tags: Array<{ id: number; name: string }> = []): ItemWithTags {
  return {
    id,
    name,
    path: `D:\\${name}`,
    type: "exe",
    created_at: "2026-04-26 00:00:00",
    is_favorite: false,
    tags: tags.map((tag) => ({ ...tag, color: "#fff" })),
  };
}

const items = [
  item(1, "tag", [{ id: 1, name: "2d游戏" }]),
  item(2, "忍者神龟", [{ id: 2, name: "动作" }]),
  item(3, "abc", [{ id: 1, name: "2d游戏" }, { id: 3, name: "工具" }]),
];

test("按标签筛选对象（含层级展开）", () => {
  const tagFiltered = filterItemsByTags(items, [1, 3]);
  assert.deepEqual(tagFiltered.map((i) => i.id), [3]);
  assert.equal(tagFiltered[0], items[2]);

  // 层级标签：父标签 10 的后代包含 1，选中 10 应并入标签 1 的对象（1、3）
  const descMap = buildDescendantsMap([{ parentId: 10, childId: 1 }]);
  const expand = (id: number) => descMap.get(id) ?? new Set([id]);
  assert.deepEqual(filterItemsByTags(items, [10], expand).map((i) => i.id), [1, 3]);

  // 多组 AND：{10→{1}} 与 {3} 交集 → 仅 3
  assert.deepEqual(filterItemsByTags(items, [10, 3], expand).map((i) => i.id), [3]);

  // 不提供 expand 时退化为精确匹配（无对象直接打 10）→ 空
  assert.deepEqual(filterItemsByTags(items, [10]).map((i) => i.id), []);
});

test("按标签筛选：反选排除（含层级展开）", () => {
  // 反选标签 1（2d游戏）：剔除含该标签的对象 1、3 → 仅剩 2
  assert.deepEqual(filterItemsByTags(items, [], undefined, [1]).map((i) => i.id), [2]);

  // 正选 {3}（工具）∩ 反选 {1}（2d游戏）→ 对象 3 同时含两者，被剔除 → 空
  assert.deepEqual(filterItemsByTags(items, [3], undefined, [1]).map((i) => i.id), []);

  // 层级：父标签 10 的后代含 1，反选 10 应连同后代对象一起剔除
  const descMap = buildDescendantsMap([{ parentId: 10, childId: 1 }]);
  const expand = (id: number) => descMap.get(id) ?? new Set([id]);
  assert.deepEqual(filterItemsByTags(items, [], expand, [10]).map((i) => i.id), [2]);

  // 正反选同传一个标签（异常态）：正选命中后又被反选剔除 → 空
  assert.deepEqual(filterItemsByTags(items, [1], undefined, [1]).map((i) => i.id), []);
});

test("B10 多层级标签闭包（两跳后代）", () => {
  const multiLevelDescMap = buildDescendantsMap([{ parentId: 100, childId: 10 }, { parentId: 10, childId: 1 }]);
  const multiLevelExpand = (id: number) => multiLevelDescMap.get(id) ?? new Set([id]);
  assert.deepEqual(filterItemsByTags(items, [100], multiLevelExpand).map((i) => i.id), [1, 3]);
});

test("A→C←B 真值表：含后代 vs 仅直接标签（正选/排除/多选）", () => {
  // A 与 B 同为 C 的父；对象只打直接标签，不把祖先写入 item_tags
  const diamond = [
    item(10, "onlyA", [{ id: 1, name: "A" }]),
    item(11, "onlyB", [{ id: 2, name: "B" }]),
    item(12, "onlyC", [{ id: 3, name: "C" }]),
    item(13, "AandC", [{ id: 1, name: "A" }, { id: 3, name: "C" }]),
    item(14, "ABC", [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }]),
  ];
  const map = buildDescendantsMap([
    { parentId: 1, childId: 3 },
    { parentId: 2, childId: 3 },
  ]);
  const expand = (id: number) => map.get(id) ?? new Set([id]);
  const ids = (selected: number[], excluded: number[] = [], withExpand = true) =>
    filterItemsByTags(diamond, selected, withExpand ? expand : undefined, excluded).map((entry) => entry.id);

  assert.deepEqual(ids([1]), [10, 12, 13, 14]);
  assert.deepEqual(ids([2]), [11, 12, 13, 14]);
  assert.deepEqual(ids([1, 2]), [12, 13, 14]);
  assert.deepEqual(ids([], [1]), [11]);
  assert.deepEqual(ids([1], [2]), [10]);

  assert.deepEqual(ids([1], [], false), [10, 13, 14]);
  assert.deepEqual(ids([2], [], false), [11, 14]);
  assert.deepEqual(ids([1, 2], [], false), [14]);
  assert.deepEqual(ids([], [1], false), [11, 12]);
  assert.deepEqual(ids([1], [2], false), [10, 13]);
});

await run("tagFilter");

import { assert, test, run } from "./__testutil";
import {
  applyRecentFilter,
  applyTypeFilter,
  applyWorkspaceQuery,
  compareItems,
  filterCommandsByQuery,
  formatBytes,
  formatTimestamp,
  isSortMode,
  isTypeFilter,
  itemMatchesType,
  nextSelectionIndex,
  sortItemsByMode,
} from "./itemQuery";
import type { ItemWithTags } from "../types";

function item(partial: Partial<ItemWithTags> & { id: number; name: string }): ItemWithTags {
  return {
    path: `D:\\${partial.name}`,
    type: "exe",
    created_at: "2026-01-01 00:00:00",
    is_favorite: false,
    tags: [],
    ...partial,
  };
}

test("itemMatchesType：脚本合并 bat 与 ps1", () => {
  assert.equal(itemMatchesType({ type: "bat" }, "script"), true);
  assert.equal(itemMatchesType({ type: "ps1" }, "script"), true);
  assert.equal(itemMatchesType({ type: "exe" }, "script"), false);
  assert.equal(itemMatchesType({ type: "folder" }, "all"), true);
});

test("applyTypeFilter：all 返回原数组引用", () => {
  const items = [item({ id: 1, name: "a" })];
  assert.equal(applyTypeFilter(items, "all"), items);
});

test("applyRecentFilter：仅保留有 last_used_at 的项", () => {
  const items = [
    item({ id: 1, name: "used", last_used_at: "2026-08-01 12:00:00" }),
    item({ id: 2, name: "never" }),
  ];
  assert.deepEqual(applyRecentFilter(items, true).map((entry) => entry.id), [1]);
  assert.equal(applyRecentFilter(items, false), items);
});

test("smart 排序：收藏置顶，其次最近使用，再次名称", () => {
  const items = [
    item({ id: 1, name: "zeta", last_used_at: "2026-08-01 10:00:00" }),
    item({ id: 2, name: "alpha" }),
    item({ id: 3, name: "beta", is_favorite: true }),
    item({ id: 4, name: "gamma", last_used_at: "2026-08-02 10:00:00" }),
  ];
  assert.deepEqual(sortItemsByMode(items, "smart").map((entry) => entry.id), [3, 4, 1, 2]);
});

test("name / recent / added / type 排序", () => {
  const items = [
    item({ id: 1, name: "zeta", type: "folder", created_at: "2026-01-03 00:00:00", last_used_at: "2026-08-01" }),
    item({ id: 2, name: "alpha", type: "exe", created_at: "2026-01-01 00:00:00" }),
    item({ id: 3, name: "beta", type: "image", created_at: "2026-01-02 00:00:00", last_used_at: "2026-08-03" }),
  ];
  assert.deepEqual(sortItemsByMode(items, "name").map((entry) => entry.id), [2, 3, 1]);
  assert.deepEqual(sortItemsByMode(items, "recent").map((entry) => entry.id), [3, 1, 2]);
  assert.deepEqual(sortItemsByMode(items, "added").map((entry) => entry.id), [1, 3, 2]);
  assert.deepEqual(sortItemsByMode(items, "type").map((entry) => entry.id), [1, 3, 2]);
});

test("applyWorkspaceQuery：先类型筛选再排序", () => {
  const items = [
    item({ id: 1, name: "zeta", type: "image" }),
    item({ id: 2, name: "alpha", type: "image" }),
    item({ id: 3, name: "tool", type: "exe" }),
  ];
  assert.deepEqual(
    applyWorkspaceQuery(items, { typeFilter: "image", sortMode: "name" }).map((entry) => entry.id),
    [2, 1],
  );
});

test("compareItems smart：同收藏同时戳时按名称", () => {
  const a = item({ id: 1, name: "b", is_favorite: true });
  const b = item({ id: 2, name: "a", is_favorite: true });
  assert.ok(compareItems(a, b, "smart") > 0);
});

test("formatBytes / formatTimestamp 边界", () => {
  assert.equal(formatBytes(null), "未知大小");
  assert.equal(formatBytes(-1), "未知大小");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048576), "1 MB");
  assert.equal(formatTimestamp(undefined), "从未");
  assert.equal(formatTimestamp("2026-08-12T18:00:00"), "2026-08-12 18:00:00");
});

test("nextSelectionIndex：空列表 / 无当前项 / 夹紧", () => {
  assert.equal(nextSelectionIndex(0, -1, 1), -1);
  assert.equal(nextSelectionIndex(5, -1, 1), 0);
  assert.equal(nextSelectionIndex(5, -1, -1), 4);
  assert.equal(nextSelectionIndex(5, 0, -1), 0);
  assert.equal(nextSelectionIndex(5, 4, 1), 4);
  assert.equal(nextSelectionIndex(5, 2, 1), 3);
});

test("filterCommandsByQuery：标题与 keywords 命中，空查询返回全部", () => {
  const commands = [
    { title: "打开设置", keywords: "settings 偏好" },
    { title: "网格视图", keywords: "grid" },
  ];
  assert.equal(filterCommandsByQuery(commands, "").length, 2);
  assert.deepEqual(filterCommandsByQuery(commands, "设置").map((c) => c.title), ["打开设置"]);
  assert.deepEqual(filterCommandsByQuery(commands, "GRID").map((c) => c.title), ["网格视图"]);
});

test("isSortMode / isTypeFilter 守卫", () => {
  assert.equal(isSortMode("smart"), true);
  assert.equal(isSortMode("nope"), false);
  assert.equal(isTypeFilter("script"), true);
  assert.equal(isTypeFilter("bat"), false);
});

await run("itemQuery");

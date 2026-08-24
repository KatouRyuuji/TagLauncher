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
  isTypingTarget,
  formatPathCopy,
  isImeKeyboardEvent,
  nextTypeFilter,
  idsNeedingFavoriteToggle,
  itemMatchesType,
  nextSelectionIndex,
  previewNavigationItems,
  rangeSelectionIds,
  applyPointerSelection,
  applyContextSelection,
  selectionStep,
  stepMenuIndex,
  sortItemsByMode,
  toggleHeaderSort,
  isHeaderSortActive,
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
  assert.equal(nextSelectionIndex(8, 1, 4), 5);
});

test("selectionStep：网格按列跳转，列表按行", () => {
  assert.equal(selectionStep("list", 4, "ArrowDown"), 1);
  assert.equal(selectionStep("list", 4, "ArrowUp"), -1);
  assert.equal(selectionStep("grid", 4, "ArrowDown"), 4);
  assert.equal(selectionStep("grid", 4, "ArrowUp"), -4);
  assert.equal(selectionStep("grid", 4, "ArrowRight"), 1);
  assert.equal(selectionStep("grid", 4, "PageDown"), 16);
  assert.equal(selectionStep("list", 4, "PageUp"), -4);
  assert.equal(selectionStep("grid", 3, "Escape"), null);
});

test("previewNavigationItems：可见则走可见列表，否则走全库", () => {
  const visible = [item({ id: 2, name: "b" }), item({ id: 3, name: "c" })];
  const all = [item({ id: 1, name: "a" }), ...visible];
  assert.deepEqual(previewNavigationItems(visible, all, 3).map((entry) => entry.id), [2, 3]);
  assert.deepEqual(previewNavigationItems(visible, all, 1).map((entry) => entry.id), [1, 2, 3]);
});

test("rangeSelectionIds：锚点与焦点闭区间，焦点在末尾以便继续向外扩", () => {
  const items = [item({ id: 1, name: "a" }), item({ id: 2, name: "b" }), item({ id: 3, name: "c" }), item({ id: 4, name: "d" })];
  assert.deepEqual(rangeSelectionIds(items, 2, 4), [2, 3, 4]);
  assert.deepEqual(rangeSelectionIds(items, 4, 2), [3, 4, 2]);
  assert.deepEqual(rangeSelectionIds(items, null, 3), [3]);
  assert.deepEqual(rangeSelectionIds(items, 99, 1), [1]);
  assert.deepEqual(rangeSelectionIds(items, 1, 99), []);
});

test("applyPointerSelection：单击替换、Ctrl 切换、Shift 范围", () => {
  const ordered = [1, 2, 3, 4];
  assert.deepEqual(applyPointerSelection(ordered, [2], 4, { shift: false, additive: false, anchorId: 2 }), { ids: [4], anchorId: 4 });
  assert.deepEqual(applyPointerSelection(ordered, [2], 4, { shift: false, additive: true, anchorId: 2 }), { ids: [2, 4], anchorId: 4 });
  assert.deepEqual(applyPointerSelection(ordered, [2, 4], 4, { shift: false, additive: true, anchorId: 4 }), { ids: [2], anchorId: 4 });
  assert.deepEqual(applyPointerSelection(ordered, [2], 4, { shift: true, additive: false, anchorId: 2 }), { ids: [2, 3, 4], anchorId: 2 });
});

test("applyContextSelection：未选中则单选，已在多选中则保持并把该项放到末尾", () => {
  assert.deepEqual(applyContextSelection([], 3, null), { ids: [3], anchorId: 3 });
  assert.deepEqual(applyContextSelection([2], 4, 2), { ids: [4], anchorId: 4 });
  assert.deepEqual(applyContextSelection([2, 3, 4], 3, 2), { ids: [2, 4, 3], anchorId: 2 });
  assert.deepEqual(applyContextSelection([2, 3, 4], 4, 2), { ids: [2, 3, 4], anchorId: 2 });
});

test("filterCommandsByQuery：标题与 keywords 命中，空查询返回全部", () => {
  const commands = [
    { title: "打开设置", keywords: "settings 偏好" },
    { title: "网格视图", keywords: "grid" },
  ];
  assert.equal(filterCommandsByQuery(commands, "").length, 2);
  assert.deepEqual(filterCommandsByQuery(commands, "设置").map((c) => c.title), ["打开设置"]);
  assert.deepEqual(filterCommandsByQuery(commands, "GRID").map((c) => c.title), ["网格视图"]);
  assert.deepEqual(filterCommandsByQuery(commands, "sz").map((c) => c.title), ["打开设置"]);
});

test("stepMenuIndex：循环、Home/End、空菜单", () => {
  assert.equal(stepMenuIndex(4, 0, "ArrowDown"), 1);
  assert.equal(stepMenuIndex(4, 3, "ArrowDown"), 0);
  assert.equal(stepMenuIndex(4, 0, "ArrowUp"), 3);
  assert.equal(stepMenuIndex(4, -1, "ArrowDown"), 0);
  assert.equal(stepMenuIndex(4, -1, "ArrowUp"), 3);
  assert.equal(stepMenuIndex(4, 2, "Home"), 0);
  assert.equal(stepMenuIndex(4, 2, "End"), 3);
  assert.equal(stepMenuIndex(0, 0, "ArrowDown"), null);
  assert.equal(stepMenuIndex(3, 1, "Enter"), null);
});

test("idsNeedingFavoriteToggle：有未收藏则只补收藏，全已收藏则全部取消", () => {
  assert.deepEqual(idsNeedingFavoriteToggle([]), []);
  assert.deepEqual(idsNeedingFavoriteToggle([{ id: 1, is_favorite: false }]), [1]);
  assert.deepEqual(idsNeedingFavoriteToggle([{ id: 1, is_favorite: true }]), [1]);
  assert.deepEqual(
    idsNeedingFavoriteToggle([
      { id: 1, is_favorite: true },
      { id: 2, is_favorite: false },
      { id: 3, is_favorite: true },
    ]),
    [2],
  );
  assert.deepEqual(
    idsNeedingFavoriteToggle([
      { id: 1, is_favorite: true },
      { id: 2, is_favorite: true },
    ]),
    [1, 2],
  );
});

test("nextTypeFilter：再点当前类型回到全部", () => {
  assert.equal(nextTypeFilter("all", "image"), "image");
  assert.equal(nextTypeFilter("image", "image"), "all");
  assert.equal(nextTypeFilter("image", "audio"), "audio");
  assert.equal(nextTypeFilter("script", "all"), "all");
});

test("isSortMode / isTypeFilter 守卫", () => {
  assert.equal(isSortMode("smart"), true);
  assert.equal(isSortMode("nope"), false);
  assert.equal(isTypeFilter("script"), true);
  assert.equal(isTypeFilter("bat"), false);
});

test("formatPathCopy：空路径忽略，多项换行", () => {
  assert.equal(formatPathCopy([]), null);
  assert.equal(formatPathCopy(["  ", ""]), null);
  assert.deepEqual(formatPathCopy(["D:\\a.exe"]), { text: "D:\\a.exe", message: "已复制路径" });
  assert.deepEqual(formatPathCopy(["D:\\a.exe", "  ", "D:\\b.png"]), {
    text: "D:\\a.exe\nD:\\b.png",
    message: "已复制 2 条路径",
  });
});

test("isImeKeyboardEvent：组合输入与 Process 键", () => {
  assert.equal(isImeKeyboardEvent({ key: "Enter", nativeEvent: { isComposing: true } }), true);
  assert.equal(isImeKeyboardEvent({ key: "Process", nativeEvent: {} }), true);
  assert.equal(isImeKeyboardEvent({ key: "Enter", nativeEvent: { isComposing: false } }), false);
});

test("toggleHeaderSort：点击表头切到该列排序", () => {
  assert.equal(toggleHeaderSort("smart", "name"), "name");
  assert.equal(toggleHeaderSort("recent", "name"), "name");
  assert.equal(toggleHeaderSort("smart", "type"), "type");
});

test("toggleHeaderSort：已按该列排序时再点一次回到智能排序", () => {
  assert.equal(toggleHeaderSort("name", "name"), "smart");
  assert.equal(toggleHeaderSort("type", "type"), "smart");
});

test("toggleHeaderSort：在两列之间直接切换，无须先回智能", () => {
  assert.equal(toggleHeaderSort("name", "type"), "type");
  assert.equal(toggleHeaderSort("type", "name"), "name");
});

test("isHeaderSortActive：仅当前列排序生效时为 true", () => {
  assert.equal(isHeaderSortActive("name", "name"), true);
  assert.equal(isHeaderSortActive("name", "type"), false);
  assert.equal(isHeaderSortActive("smart", "name"), false);
  assert.equal(isHeaderSortActive("type", "type"), true);
});

await run("itemQuery");

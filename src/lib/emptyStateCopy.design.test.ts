import { assert, test, run } from "./__testutil";
import { emptyStateCopy, resolveEmptyStateVariant, truncateQueryForDisplay } from "./emptyStateCopy";

test("库空时始终是 library 空态（即便残留搜索词）", () => {
  assert.equal(resolveEmptyStateVariant("library", ""), "library");
  assert.equal(resolveEmptyStateVariant("library", "游戏"), "library");
});

test("筛选无命中：有搜索词按 search、无搜索词按 filter 区分", () => {
  assert.equal(resolveEmptyStateVariant("filter", "游戏"), "search");
  assert.equal(resolveEmptyStateVariant("filter", ""), "filter");
  // 纯空白搜索词不算搜索
  assert.equal(resolveEmptyStateVariant("filter", "   "), "filter");
});

test("文件柜 / 收藏 / 最近 使用专用空态，不被筛选文案冒充", () => {
  assert.equal(resolveEmptyStateVariant("filter", "", { cabinet: true }), "cabinet");
  assert.equal(resolveEmptyStateVariant("filter", "", { favorites: true }), "favorites");
  assert.equal(resolveEmptyStateVariant("filter", "", { recent: true }), "recent");
  assert.equal(resolveEmptyStateVariant("filter", "游戏", { cabinet: true }), "search");
  assert.ok(emptyStateCopy("cabinet", "").title.includes("文件柜"));
  assert.ok(emptyStateCopy("cabinet", "").description.includes("分组"));
});

test("library 空态：引导导入，不提供清筛选/清搜索按钮", () => {
  const copy = emptyStateCopy("library", "");
  assert.equal(copy.title, "暂无项目");
  assert.ok(copy.description.includes("加入库"));
  assert.equal(copy.showClearSearch, false);
  assert.equal(copy.showClearFilters, false);
});

test("library 空态：概念解释退居注脚，与主引导分层", () => {
  const copy = emptyStateCopy("library", "");
  assert.ok(!copy.description.includes("文件柜只是分组"));
  assert.ok(copy.footnote?.includes("文件柜只是分组"));
});

test("library 空态：按仍在的标签/文件柜如实补一句", () => {
  const both = emptyStateCopy("library", "", { hasTags: true, hasCabinets: true });
  assert.equal(both.title, "暂无项目");
  assert.ok(both.footnote?.includes("标签和文件柜还在"));
  const tagsOnly = emptyStateCopy("library", "", { hasTags: true });
  assert.ok(tagsOnly.footnote?.includes("标签还在"));
  assert.ok(!tagsOnly.footnote?.includes("文件柜还在"));
  const cabinetsOnly = emptyStateCopy("library", "", { hasCabinets: true });
  assert.ok(cabinetsOnly.footnote?.includes("文件柜还在"));
  assert.ok(!cabinetsOnly.footnote?.includes("标签还在"));
});

test("library 空态：没有标签和文件柜时不提它们还在", () => {
  const copy = emptyStateCopy("library", "");
  assert.ok(!copy.footnote?.includes("还在，可以继续用"));
  const emptyContext = emptyStateCopy("library", "", { hasTags: false, hasCabinets: false });
  assert.ok(!emptyContext.footnote?.includes("还在，可以继续用"));
});

test("search 空态：标题含搜索词，提供清空搜索与清空筛选两个动作", () => {
  const copy = emptyStateCopy("search", "忍者神龟");
  assert.ok(copy.title.includes("忍者神龟"));
  assert.equal(copy.showClearSearch, true);
  assert.equal(copy.showClearFilters, true);
});

test("filter 空态：只提供清空筛选", () => {
  const copy = emptyStateCopy("filter", "");
  assert.equal(copy.title, "没有匹配的项目");
  assert.equal(copy.showClearSearch, false);
  assert.equal(copy.showClearFilters, true);
});

test("超长搜索词在标题中截断，避免撑破空态面板", () => {
  const longQuery = "x".repeat(80);
  assert.equal(truncateQueryForDisplay(longQuery), `${"x".repeat(24)}…`);
  const copy = emptyStateCopy("search", longQuery);
  assert.ok(copy.title.length < 40);
  // 短词与首尾空白不受影响
  assert.equal(truncateQueryForDisplay("  游戏  "), "游戏");
});

await run("emptyStateCopy");

// ============================================================================
// lib/search.design.test.ts — 搜索设计回归（索引构建 / 表达式 / 模糊容错 / 层级标签）
// ============================================================================
import { assert, test, run } from "./__testutil";
import { buildSearchIndex, filterItemsByTags, filterSearchIndex, searchWithIndex } from "./search";
import { buildDescendantsMap } from "./tagGraph";
import { setSynonymGroups } from "./synonyms";
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

setSynonymGroups([
  ["忍者神龟", "四小王八"],
  ["2d游戏", "平面游戏"],
]);

const allIndex = buildSearchIndex(items, "all");
const tagIndex = buildSearchIndex(items, "tag");

test("基础搜索与同义词扩展", () => {
  assert.equal(searchWithIndex(allIndex, "")[0], items[0]);
  assert.deepEqual(searchWithIndex(allIndex, "ta").map((i) => i.id), [1]);
  assert.equal(searchWithIndex(allIndex, "ta")[0], items[0]);
  assert.deepEqual(searchWithIndex(allIndex, "ag").map((i) => i.id), []);
  assert.deepEqual(searchWithIndex(allIndex, "renzheshengui").map((i) => i.id), [2]);
  assert.deepEqual(searchWithIndex(allIndex, "zhe").map((i) => i.id), []);
  assert.deepEqual(searchWithIndex(allIndex, "四小王八").map((i) => i.id), [2]);
});

test("标签索引搜索（含同义词）", () => {
  assert.deepEqual(searchWithIndex(tagIndex, "2dyouxi").map((i) => i.id), [1, 3]);
  assert.deepEqual(searchWithIndex(tagIndex, "平面游戏").map((i) => i.id), [1, 3]);
});

test("表达式：或 / 与 / 排除 / 分组", () => {
  assert.deepEqual(searchWithIndex(allIndex, "tag||忍者").map((i) => i.id), [1, 2]);
  assert.deepEqual(searchWithIndex(allIndex, "tag 忍者").map((i) => i.id), [1, 2]);
  assert.deepEqual(searchWithIndex(allIndex, "tag&&2d").map((i) => i.id), [1]);
  assert.deepEqual(searchWithIndex(allIndex, "!!tag").map((i) => i.id), [2, 3]);
  assert.deepEqual(searchWithIndex(allIndex, "(tag||忍者)!!忍者").map((i) => i.id), [1]);
});

test("表达式：操作符两侧空格与一元排除", () => {
  // 允许 "tag || 忍者" 形式（操作符两侧空格被吞掉）
  assert.deepEqual(searchWithIndex(allIndex, "tag || 忍者").map((i) => i.id), [1, 2]);
  assert.deepEqual(searchWithIndex(allIndex, "tag || 2d游戏").map((i) => i.id), [1, 3]);

  // 一元 !! 为左结合排除：tag||!!tag = tag || (!!tag) = 全集
  assert.deepEqual(searchWithIndex(allIndex, "tag||!!tag").map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(searchWithIndex(allIndex, "tag || !!tag").map((i) => i.id), [1, 2, 3]);

  // 空格同样视为 AND：tag !!2d游戏 → tag AND (NOT 2d游戏) = 空
  assert.deepEqual(searchWithIndex(allIndex, "tag !!2d游戏").map((i) => i.id), []);
  assert.deepEqual(searchWithIndex(allIndex, "@忍者神龟").map((i) => i.id), [2]);
  assert.deepEqual(searchWithIndex(allIndex, "@忍者").map((i) => i.id), []);
});

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

test("排除表达式与顺序无关", () => {
  const excludeItems = [item(11, "alpha"), item(12, "beta"), item(13, "gamma")];
  const excludeIndex = buildSearchIndex(excludeItems, "all");
  assert.deepEqual(searchWithIndex(excludeIndex, "(alpha||beta||gamma)!!beta!!gamma").map((i) => i.id), [11]);
  // 交换两个排除项顺序结果一致（左结合排除对顺序不敏感）
  assert.deepEqual(searchWithIndex(excludeIndex, "(alpha||beta||gamma)!!gamma!!beta").map((i) => i.id), [11]);
});

test("B2 短词模糊容错：首字符一致才允许模糊", () => {
  const typoItems = [item(21, "test"), item(22, "node")];
  const typoIndex = buildSearchIndex(typoItems, "name");
  // 正例：test 与 tesst/teest/test/trst 互相模糊命中（首字符一致）
  assert.deepEqual(searchWithIndex(typoIndex, "tesst").map((i) => i.id), [21]);
  assert.deepEqual(searchWithIndex(typoIndex, "teest").map((i) => i.id), [21]);
  assert.deepEqual(searchWithIndex(typoIndex, "test").map((i) => i.id), [21]);
  assert.deepEqual(searchWithIndex(typoIndex, "trst").map((i) => i.id), [21]);
  // 反例：bode 首字母与 node 不同，不应误命中
  assert.deepEqual(searchWithIndex(typoIndex, "bode").map((i) => i.id), []);
  // 反例：bc 不应命中 abc（短于模糊阈值且前缀不符）
  const bcIndex = buildSearchIndex([item(23, "abc")], "name");
  assert.deepEqual(searchWithIndex(bcIndex, "bc").map((i) => i.id), []);
});

test("B3 path 弱字段先剥离盘符前缀", () => {
  function pathItem(id: number, name: string, path: string): ItemWithTags {
    return { id, name, path, type: "exe", created_at: "2026-04-26 00:00:00", is_favorite: false, tags: [] };
  }
  const driveIndex = buildSearchIndex([pathItem(31, "zebra", "D:\\zebra")], "name");
  assert.deepEqual(searchWithIndex(driveIndex, "d").map((i) => i.id), []);
  assert.deepEqual(searchWithIndex(driveIndex, "d:").map((i) => i.id), []);
});

test("B4 收藏置顶为显式保证（稳定排序）", () => {
  function favItem(id: number, name: string, isFavorite: boolean): ItemWithTags {
    return { id, name, path: `D:\\${name}`, type: "exe", created_at: "2026-04-26 00:00:00", is_favorite: isFavorite, tags: [] };
  }
  const favItems = [
    favItem(41, "stx", false),
    favItem(42, "stx", true),
    favItem(43, "stx", false),
    favItem(44, "stx", true),
  ];
  const favIndex = buildSearchIndex(favItems, "name");
  // 收藏(42,44)置顶且保持相对顺序，非收藏(41,43)在后且保持相对顺序
  assert.deepEqual(searchWithIndex(favIndex, "stx").map((i) => i.id), [42, 44, 41, 43]);
});

test("B5 表达式优先级：&& 强于 ||，!! 最弱；括号可改分组", () => {
  // "忍者&&动作||2d游戏" = (忍者&&动作) || 2d游戏 → {1,2,3}
  assert.deepEqual(searchWithIndex(allIndex, "忍者&&动作||2d游戏").map((i) => i.id), [1, 2, 3]);
  // 加括号改变分组："(忍者||2d游戏)&&动作" → 仅 2
  assert.deepEqual(searchWithIndex(allIndex, "(忍者||2d游戏)&&动作").map((i) => i.id), [2]);
  // 嵌套括号不改变语义
  assert.deepEqual(searchWithIndex(allIndex, "((tag))").map((i) => i.id), searchWithIndex(allIndex, "tag").map((i) => i.id));
});

test("B6 @ 严格模式：名称与标签名精确匹配", () => {
  // 标签"2d游戏"被 1、3 精确持有；两者名称都不是"2d游戏"，说明走标签精确匹配
  assert.deepEqual(searchWithIndex(allIndex, "@2d游戏").map((i) => i.id), [1, 3]);
  // 对象 1 的名称恰为"tag"，无同名标签，@严格匹配应仅命中名称
  assert.deepEqual(searchWithIndex(allIndex, "@tag").map((i) => i.id), [1]);
});

test("B7 拼音首字母匹配", () => {
  assert.deepEqual(searchWithIndex(allIndex, "rzsg").map((i) => i.id), [2]);
  assert.deepEqual(searchWithIndex(allIndex, "rz").map((i) => i.id), [2]);
});

test("B8 模糊容错阈值：长度 >= 5 不要求首字母一致", () => {
  const longTypoItems = [item(51, "hello"), item(52, "world")];
  const longTypoIndex = buildSearchIndex(longTypoItems, "name");
  // "jello" 与 "hello" 编辑距离为 1 且长度为 5，首字母不同（h≠j）也应命中
  assert.deepEqual(searchWithIndex(longTypoIndex, "jello").map((i) => i.id), [51]);
  // "jelly" 与 "hello" 编辑距离为 2，超出容错阈值，不应命中
  assert.deepEqual(searchWithIndex(longTypoIndex, "jelly").map((i) => i.id), []);
});

test("B9 @ 严格模式绕过同义词扩展", () => {
  // "四小王八"是"忍者神龟"的同义词，但 @ 严格模式不做同义词展开
  assert.deepEqual(searchWithIndex(allIndex, "@四小王八").map((i) => i.id), []);
});

test("B10 多层级标签闭包（两跳后代）", () => {
  const multiLevelDescMap = buildDescendantsMap([{ parentId: 100, childId: 10 }, { parentId: 10, childId: 1 }]);
  const multiLevelExpand = (id: number) => multiLevelDescMap.get(id) ?? new Set([id]);
  assert.deepEqual(filterItemsByTags(items, [100], multiLevelExpand).map((i) => i.id), [1, 3]);
});

test("filterSearchIndex：按允许集过滤索引", () => {
  const layeredIndex = buildSearchIndex(items, "all");
  const allowed = new Set([1, 2]);
  const filtered = filterSearchIndex(layeredIndex, allowed);
  assert.equal(filtered.entries.length, 2);
  assert.deepEqual(filtered.entries.map((entry) => entry.item.id), [1, 2]);
  assert.equal(filterSearchIndex(layeredIndex, new Set(items.map((i) => i.id))), layeredIndex);
});

await run("search");

import assert from "node:assert/strict";
import { buildSearchIndex, filterItemsByTags, searchWithIndex } from "./search";
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
assert.equal(searchWithIndex(allIndex, "")[0], items[0]);
assert.deepEqual(searchWithIndex(allIndex, "ta").map((i) => i.id), [1]);
assert.equal(searchWithIndex(allIndex, "ta")[0], items[0]);
assert.deepEqual(searchWithIndex(allIndex, "ag").map((i) => i.id), []);
assert.deepEqual(searchWithIndex(allIndex, "renzheshengui").map((i) => i.id), [2]);
assert.deepEqual(searchWithIndex(allIndex, "zhe").map((i) => i.id), []);
assert.deepEqual(searchWithIndex(allIndex, "四小王八").map((i) => i.id), [2]);

const tagIndex = buildSearchIndex(items, "tag");
assert.deepEqual(searchWithIndex(tagIndex, "2dyouxi").map((i) => i.id), [1, 3]);
assert.deepEqual(searchWithIndex(tagIndex, "平面游戏").map((i) => i.id), [1, 3]);

assert.deepEqual(searchWithIndex(allIndex, "tag||忍者").map((i) => i.id), [1, 2]);
assert.deepEqual(searchWithIndex(allIndex, "tag 忍者").map((i) => i.id), [1, 2]);
assert.deepEqual(searchWithIndex(allIndex, "tag&&2d").map((i) => i.id), [1]);
assert.deepEqual(searchWithIndex(allIndex, "!!tag").map((i) => i.id), [2, 3]);
assert.deepEqual(searchWithIndex(allIndex, "(tag||忍者)!!忍者").map((i) => i.id), [1]);
assert.deepEqual(searchWithIndex(allIndex, "@忍者神龟").map((i) => i.id), [2]);
assert.deepEqual(searchWithIndex(allIndex, "@忍者").map((i) => i.id), []);

const tagFiltered = filterItemsByTags(items, [1, 3]);
assert.deepEqual(tagFiltered.map((i) => i.id), [3]);
assert.equal(tagFiltered[0], items[2]);

// B1：多重排除应左结合 ((A−B)−C)，依次差集，而非右结合错误保留满足最后排除条件者
const excludeItems = [item(11, "alpha"), item(12, "beta"), item(13, "gamma")];
const excludeIndex = buildSearchIndex(excludeItems, "all");
assert.deepEqual(searchWithIndex(excludeIndex, "(alpha||beta||gamma)!!beta!!gamma").map((i) => i.id), [11]);
// 对称：交换两个排除项顺序，结果不变
assert.deepEqual(searchWithIndex(excludeIndex, "(alpha||beta||gamma)!!gamma!!beta").map((i) => i.id), [11]);

// B2：短词（<5 字母）模糊收紧——首字母不同不再误命中，但正例（首字母相同、编辑距离<=1）仍命中
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

// B3：path 弱字段先剥离盘符前缀，单个盘符字母不应命中大量对象
function pathItem(id: number, name: string, path: string): ItemWithTags {
  return { id, name, path, type: "exe", created_at: "2026-04-26 00:00:00", is_favorite: false, tags: [] };
}
const driveIndex = buildSearchIndex([pathItem(31, "zebra", "D:\\zebra")], "name");
assert.deepEqual(searchWithIndex(driveIndex, "d").map((i) => i.id), []);
assert.deepEqual(searchWithIndex(driveIndex, "d:").map((i) => i.id), []);

// B4：收藏置顶为显式保证——is_favorite 为真者在前，其余保持相对顺序（稳定排序）
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

console.log("search design tests passed");

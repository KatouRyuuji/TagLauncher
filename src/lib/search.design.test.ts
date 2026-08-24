import assert from "node:assert/strict";
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
// 回归：空格紧邻显式操作符时不得叠加隐式 or（曾产生连续两个 or 被过滤逻辑一并删除，
// 导致 "tag || 忍者" 只剩 "tag" 前半段）
assert.deepEqual(searchWithIndex(allIndex, "tag || 忍者").map((i) => i.id), [1, 2]);
assert.deepEqual(searchWithIndex(allIndex, "tag || 2d游戏").map((i) => i.id), [1, 3]);
// 回归：一元 !! 可出现在 || 操作数位置（A||!!B = A ∪ (全集−B)），
// 曾因 parseOr 右侧不识别 not 而直接丢弃整个右分支
assert.deepEqual(searchWithIndex(allIndex, "tag||!!tag").map((i) => i.id), [1, 2, 3]);
assert.deepEqual(searchWithIndex(allIndex, "tag || !!tag").map((i) => i.id), [1, 2, 3]);
// 空格分隔的 !! 与紧邻写法同义（排除语义）：tag !!2d游戏 = 命中 tag 但排除 2d游戏 → 空
assert.deepEqual(searchWithIndex(allIndex, "tag !!2d游戏").map((i) => i.id), []);
assert.deepEqual(searchWithIndex(allIndex, "@忍者神龟").map((i) => i.id), [2]);
assert.deepEqual(searchWithIndex(allIndex, "@忍者").map((i) => i.id), []);

const tagFiltered = filterItemsByTags(items, [1, 3]);
assert.deepEqual(tagFiltered.map((i) => i.id), [3]);
assert.equal(tagFiltered[0], items[2]);

// 图状标签层级：父标签 10 → 子标签 1（"2d游戏"）。选中父标签应并入打了子标签的对象（1、3）。
const descMap = buildDescendantsMap([{ parentId: 10, childId: 1 }]);
const expand = (id: number) => descMap.get(id) ?? new Set([id]);
assert.deepEqual(filterItemsByTags(items, [10], expand).map((i) => i.id), [1, 3]);
// 与其它选中标签求交集：父标签 10（并入子1） AND 标签 3 → 仅同时满足者（item 3）
assert.deepEqual(filterItemsByTags(items, [10, 3], expand).map((i) => i.id), [3]);
// 不传 expand 时退化为精确匹配：没有对象直接打了标签 10
assert.deepEqual(filterItemsByTags(items, [10]).map((i) => i.id), []);

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

// B5：表达式优先级——&& 绑定强于 ||，!! 绑定最弱（无括号时）；括号可显式改变分组
// "忍者&&动作||2d游戏" = (忍者&&动作) || 2d游戏：忍者&&动作 只命中 2（名称+标签同时满足），
// 再与 2d游戏（命中 1、3）取并集 → {1,2,3}
assert.deepEqual(searchWithIndex(allIndex, "忍者&&动作||2d游戏").map((i) => i.id), [1, 2, 3]);
// 加括号改变分组："(忍者||2d游戏)&&动作" 先并集 {1,2,3} 再与"动作"取交集 → 仅 2
assert.deepEqual(searchWithIndex(allIndex, "(忍者||2d游戏)&&动作").map((i) => i.id), [2]);
// 嵌套括号不改变语义："((tag))" 等价于 "tag"
assert.deepEqual(searchWithIndex(allIndex, "((tag))").map((i) => i.id), searchWithIndex(allIndex, "tag").map((i) => i.id));

// B6：@ 严格模式——除匹配对象名称外，"all" 模式下也会精确匹配标签名（matchesTerm 对 all 模式同时检查 name 和 tag）
// 标签"2d游戏"被 1、3 精确持有；两者名称都不是"2d游戏"，说明确实是走标签精确匹配命中
assert.deepEqual(searchWithIndex(allIndex, "@2d游戏").map((i) => i.id), [1, 3]);
// 对象 1 的名称恰为"tag"，无同名标签，@严格匹配应仅命中名称
assert.deepEqual(searchWithIndex(allIndex, "@tag").map((i) => i.id), [1]);

// B7：拼音首字母匹配——"忍者神龟"首字母为 rzsg，完整/前缀首字母串均应命中
assert.deepEqual(searchWithIndex(allIndex, "rzsg").map((i) => i.id), [2]);
assert.deepEqual(searchWithIndex(allIndex, "rz").map((i) => i.id), [2]);

// B8：模糊容错阈值——长度 >= 5 时不再要求首字母一致（区别于 B2 的 <5 短词场景）
const longTypoItems = [item(51, "hello"), item(52, "world")];
const longTypoIndex = buildSearchIndex(longTypoItems, "name");
// "jello" 与 "hello" 编辑距离为 1 且长度为 5，首字母不同（h≠j）也应命中
assert.deepEqual(searchWithIndex(longTypoIndex, "jello").map((i) => i.id), [51]);
// "jelly" 与 "hello" 编辑距离为 2，超出容错阈值，不应命中
assert.deepEqual(searchWithIndex(longTypoIndex, "jelly").map((i) => i.id), []);

// B9：strict（@）模式绕过同义词扩展——"四小王八"是"忍者神龟"的同义词，但对象 2 的真实名称是"忍者神龟"，
// @ 严格模式不做同义词展开，因此不应命中（区别于非严格模式下 "四小王八" 已在文件顶部验证可以命中）
assert.deepEqual(searchWithIndex(allIndex, "@四小王八").map((i) => i.id), []);

// B10：多层级标签闭包——父标签 100 → 10 → 1（两跳），选中最上层父标签应仍并入最终叶子标签的对象
const multiLevelDescMap = buildDescendantsMap([{ parentId: 100, childId: 10 }, { parentId: 10, childId: 1 }]);
const multiLevelExpand = (id: number) => multiLevelDescMap.get(id) ?? new Set([id]);
assert.deepEqual(filterItemsByTags(items, [100], multiLevelExpand).map((i) => i.id), [1, 3]);

const layeredIndex = buildSearchIndex(items, "all");
const allowed = new Set([1, 2]);
const filtered = filterSearchIndex(layeredIndex, allowed);
assert.equal(filtered.entries.length, 2);
assert.deepEqual(filtered.entries.map((entry) => entry.item.id), [1, 2]);
assert.equal(filterSearchIndex(layeredIndex, new Set(items.map((i) => i.id))), layeredIndex);

console.log("search design tests passed");

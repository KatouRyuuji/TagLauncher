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
assert.deepEqual(searchWithIndex(allIndex, "ta").map((i) => i.id), [1]);
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

assert.deepEqual(filterItemsByTags(items, [1, 3]).map((i) => i.id), [3]);

console.log("search design tests passed");

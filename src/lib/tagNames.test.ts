// ============================================================================
// lib/tagNames.test.ts — 侧栏标签：大小写查重（BUG-15）与拼音过滤（BUG-16）
// ============================================================================
import { assert, test, run } from "./__testutil";
import { ensurePinyin } from "./pinyinProvider";

await ensurePinyin();
import { findTagByNameInsensitive } from "./tagNames";
import { matchesNameQuery } from "./search";

test("BUG-15 新建标签大小写不敏感命中既有标签", () => {
  const tags = [{ id: 1, name: "Game", color: "#000" }, { id: 2, name: "工作", color: "#000" }];
  assert.equal(findTagByNameInsensitive(tags, "game")?.id, 1);
  assert.equal(findTagByNameInsensitive(tags, "  GAME ")?.id, 1);
  assert.equal(findTagByNameInsensitive(tags, "games"), undefined);
});

test("BUG-16 标签过滤支持首字母/全拼前缀，仍保留子串", () => {
  const names = ["工作", "学习", "游戏", "音乐", "电影", "照片", "文档", "代码", "设计", "旅行", "Game"];
  const hit = (q: string) => names.filter((n) => matchesNameQuery(n, q));
  assert.deepEqual(hit("gz"), ["工作"]);
  assert.deepEqual(hit("gongz"), ["工作"]);
  assert.deepEqual(hit("yx"), ["游戏"]);
  assert.deepEqual(hit("am"), ["Game"]);
  assert.deepEqual(hit("学"), ["学习"]);
  // pinyin 未就绪时只做子串
  assert.equal(matchesNameQuery("工作", "gz", false), false);
});

await run("tagNames");

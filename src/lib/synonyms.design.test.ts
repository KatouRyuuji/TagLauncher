import { assert, test, run } from "./__testutil";
import { setSynonymGroups, expandQuery, loadSynonyms } from "./synonyms";

test("expandQuery：命中同义组时返回 [原查询, ...组内其它词]", () => {
  setSynonymGroups([["忍者神龟", "四小王八"]]);
  assert.deepEqual(expandQuery("忍者神龟"), ["忍者神龟", "四小王八"]);
  assert.deepEqual(expandQuery("四小王八"), ["四小王八", "忍者神龟"]);
});

test("expandQuery：未命中任何同义组时原样返回 [query]", () => {
  setSynonymGroups([["忍者神龟", "四小王八"]]);
  assert.deepEqual(expandQuery("无关词"), ["无关词"]);
});

test("expandQuery：空/纯空白查询直接原样返回，不做分组查找", () => {
  setSynonymGroups([["a", "b"]]);
  assert.deepEqual(expandQuery(""), [""]);
  assert.deepEqual(expandQuery("   "), ["   "]);
});

test("expandQuery：大小写不敏感匹配分组 key，但保留原查询大小写", () => {
  setSynonymGroups([["abc", "xyz"]]);
  assert.deepEqual(expandQuery("ABC"), ["ABC", "xyz"]);
});

test("expandQuery：查询前后空白会被 trim 后用于分组查找", () => {
  setSynonymGroups([["abc", "xyz"]]);
  assert.deepEqual(expandQuery("  abc  "), ["  abc  ", "xyz"]);
});

test("expandQuery：三词及以上同义组，返回除自身外的全部成员", () => {
  setSynonymGroups([["a", "b", "c"]]);
  assert.deepEqual(expandQuery("a"), ["a", "b", "c"]);
});

test("setSynonymGroups：组内词条自身前后空白在建表时被 trim/小写归一", () => {
  setSynonymGroups([[" Foo ", "Bar"]]);
  assert.deepEqual(expandQuery("foo"), ["foo", "bar"]);
});

test("setSynonymGroups：空字符串词条被过滤，不污染分组", () => {
  setSynonymGroups([["foo", "", "  ", "bar"]]);
  assert.deepEqual(expandQuery("foo").sort(), ["bar", "foo"].sort());
});

test("setSynonymGroups：归一化后完全为空的组被整体跳过", () => {
  setSynonymGroups([["", "  "], ["keep", "me"]]);
  assert.deepEqual(expandQuery("keep"), ["keep", "me"]);
});

test("setSynonymGroups：重复调用是整体替换而非合并追加", () => {
  setSynonymGroups([["a", "b"]]);
  assert.deepEqual(expandQuery("a"), ["a", "b"]);
  setSynonymGroups([["c", "d"]]);
  assert.deepEqual(expandQuery("a"), ["a"]); // 旧分组已被整体替换，不再命中
  assert.deepEqual(expandQuery("c"), ["c", "d"]);
});

test("loadSynonyms：非 Tauri 环境下 invoke 失败应静默降级为空同义词表，而非抛出异常", async () => {
  // 先建立一个非空分组，验证 loadSynonyms 失败后确实把表清空（而非保留旧值）。
  setSynonymGroups([["foo", "bar"]]);
  assert.deepEqual(expandQuery("foo"), ["foo", "bar"]);

  // 纯 node 环境没有 window.__TAURI_INTERNALS__，readSynonyms() 必然失败；
  // 下面这次调用产生的 "Failed to load synonyms:" console.error 输出是预期行为
  // （验证优雅降级路径被执行到），不代表用例失败。
  await loadSynonyms();

  assert.deepEqual(expandQuery("foo"), ["foo"]); // 降级为空表，不再有同义词扩展
});

await run("synonyms");

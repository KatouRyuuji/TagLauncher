import assert from "node:assert/strict";
import test from "node:test";
import { splitHighlightSegments } from "./searchHighlight";

test("splitHighlightSegments：空查询不高亮", () => {
  assert.deepEqual(splitHighlightSegments("忍者神龟", ""), [{ text: "忍者神龟", highlighted: false }]);
});

test("splitHighlightSegments：子串命中拆分", () => {
  assert.deepEqual(splitHighlightSegments("忍者神龟", "忍者"), [
    { text: "忍者", highlighted: true },
    { text: "神龟", highlighted: false },
  ]);
});

test("splitHighlightSegments：忽略布尔操作符取首词", () => {
  assert.deepEqual(splitHighlightSegments("TagLauncher", "tag || 忍者"), [
    { text: "Tag", highlighted: true },
    { text: "Launcher", highlighted: false },
  ]);
});

test("splitHighlightSegments：无匹配返回整段", () => {
  assert.deepEqual(splitHighlightSegments("abc", "xyz"), [{ text: "abc", highlighted: false }]);
});

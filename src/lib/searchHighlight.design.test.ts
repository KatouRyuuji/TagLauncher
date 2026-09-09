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

test("splitHighlightSegments：表达式中所有字面词项都参与高亮", () => {
  assert.deepEqual(splitHighlightSegments("tag忍者abc", "tag 忍者"), [
    { text: "tag", highlighted: true },
    { text: "忍者", highlighted: true },
    { text: "abc", highlighted: false },
  ]);
});

test("splitHighlightSegments：剥离 !! 与 @ 前缀，字面词仍高亮", () => {
  assert.deepEqual(splitHighlightSegments("TagX", "!!tag"), [
    { text: "Tag", highlighted: true },
    { text: "X", highlighted: false },
  ]);
  assert.deepEqual(splitHighlightSegments("忍者神龟", "@忍者"), [
    { text: "忍者", highlighted: true },
    { text: "神龟", highlighted: false },
  ]);
});

test("splitHighlightSegments：拼音首字母缩写高亮对应汉字", () => {
  assert.deepEqual(splitHighlightSegments("忍者神龟", "rz"), [
    { text: "忍者", highlighted: true },
    { text: "神龟", highlighted: false },
  ]);
  assert.deepEqual(splitHighlightSegments("忍者神龟", "rzsg"), [
    { text: "忍者神龟", highlighted: true },
  ]);
});

test("splitHighlightSegments：整词拼音前缀高亮覆盖的汉字区间", () => {
  assert.deepEqual(splitHighlightSegments("忍者神龟", "renzhe"), [
    { text: "忍者", highlighted: true },
    { text: "神龟", highlighted: false },
  ]);
});

test("splitHighlightSegments：拼音未命中不高亮", () => {
  assert.deepEqual(splitHighlightSegments("忍者神龟", "abc"), [
    { text: "忍者神龟", highlighted: false },
  ]);
});

test("splitHighlightSegments：无匹配返回整段", () => {
  assert.deepEqual(splitHighlightSegments("abc", "xyz"), [{ text: "abc", highlighted: false }]);
});

import { assert, test, run } from "./__testutil";
import { TYPE_ICONS, TYPE_LABELS, getTypeLabel, getFileSuffix } from "./itemUtils";
import type { ItemWithTags } from "../types";

function item(type: string, name: string): ItemWithTags {
  return {
    id: 1,
    name,
    path: `D:\\${name}`,
    type,
    created_at: "2026-04-26 00:00:00",
    is_favorite: false,
    tags: [],
  };
}

// ── getTypeLabel ────────────────────────────────────────────────────────

test("getTypeLabel：已知类型返回中文标签", () => {
  assert.equal(getTypeLabel("folder"), "文件夹");
  assert.equal(getTypeLabel("exe"), "应用程序");
});

test("getTypeLabel：未知类型原样返回，不抛异常", () => {
  assert.equal(getTypeLabel("unknown-type"), "unknown-type");
});

test("TYPE_ICONS 与 TYPE_LABELS：键集合一致，避免只在一处登记新类型", () => {
  const iconKeys = Object.keys(TYPE_ICONS).sort();
  const labelKeys = Object.keys(TYPE_LABELS).sort();
  assert.deepEqual(iconKeys, labelKeys);
});

// ── getFileSuffix ───────────────────────────────────────────────────────

test("getFileSuffix：文件夹恒返回「无后缀」", () => {
  assert.equal(getFileSuffix(item("folder", "随便叫什么.txt")), "无后缀");
});

test("getFileSuffix：无扩展名返回「无后缀」", () => {
  assert.equal(getFileSuffix(item("exe", "readme")), "无后缀");
});

test("getFileSuffix：隐藏文件（点在开头）视为无后缀", () => {
  assert.equal(getFileSuffix(item("exe", ".gitignore")), "无后缀");
});

test("getFileSuffix：点在末尾（末尾无字符）视为无后缀", () => {
  assert.equal(getFileSuffix(item("exe", "foo.")), "无后缀");
});

test("getFileSuffix：正常扩展名统一小写返回", () => {
  assert.equal(getFileSuffix(item("exe", "Setup.EXE")), ".exe");
});

test("getFileSuffix：多重扩展名取最后一个点之后的部分", () => {
  assert.equal(getFileSuffix(item("exe", "archive.tar.gz")), ".gz");
});

test("getFileSuffix：空文件名不抛异常，返回「无后缀」", () => {
  assert.equal(getFileSuffix(item("exe", "")), "无后缀");
});

await run("itemUtils");

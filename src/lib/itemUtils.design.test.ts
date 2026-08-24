import { assert, test, run } from "./__testutil";
import { TYPE_ICONS, TYPE_LABELS, getTypeLabel, getFileSuffix, truncatePathMiddle } from "./itemUtils";
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

// ── truncatePathMiddle ──────────────────────────────────────────────────

test("truncatePathMiddle：不超限的路径原样返回（含首尾空白裁剪）", () => {
  assert.equal(truncatePathMiddle("D:\\Games\\Steam", 56), "D:\\Games\\Steam");
  assert.equal(truncatePathMiddle("  D:\\Games\\Steam  ", 56), "D:\\Games\\Steam");
});

test("truncatePathMiddle：超长路径折叠中段目录，保留盘符前缀与文件名", () => {
  const path = "D:\\Games\\Steam\\steamapps\\common\\SomeVeryLongGameTitle\\bin\\x64\\launcher.exe";
  const out = truncatePathMiddle(path, 40);
  assert.ok(out.length <= 40, `折叠后长度 ${out.length} 应 ≤ 40：${out}`);
  assert.ok(out.startsWith("D:\\"), `应保留盘符前缀：${out}`);
  assert.ok(out.endsWith("\\launcher.exe"), `应保留完整文件名：${out}`);
  assert.ok(out.includes("…"), `应含省略号标记：${out}`);
});

test("truncatePathMiddle：空间允许时尽量多保留靠前的目录段", () => {
  const path = "D:\\Games\\Steam\\steamapps\\common\\Title\\launcher.exe";
  const out = truncatePathMiddle(path, 40);
  assert.ok(out.startsWith("D:\\Games\\Steam"), `前缀应包含放得下的目录段：${out}`);
});

test("truncatePathMiddle：正斜杠路径使用正斜杠折叠", () => {
  const path = "/home/user/some/deeply/nested/directory/structure/file.tar.gz";
  const out = truncatePathMiddle(path, 36);
  assert.ok(out.includes("/…/"), `应以正斜杠折叠：${out}`);
  assert.ok(out.endsWith("/file.tar.gz"), `应保留文件名：${out}`);
});

test("truncatePathMiddle：UNC 路径保留前导双反斜杠", () => {
  const path = "\\\\nas-server\\share\\media\\collections\\backups\\2026\\archive.zip";
  const out = truncatePathMiddle(path, 44);
  assert.ok(out.startsWith("\\\\nas-server"), `UNC 根前缀应完整保留：${out}`);
  assert.ok(out.endsWith("\\archive.zip"), `应保留文件名：${out}`);
});

test("truncatePathMiddle：文件名自身超长时退化为整串头尾折叠，不抛异常", () => {
  const path = `D:\\${"超长文件名".repeat(30)}.txt`;
  const out = truncatePathMiddle(path, 30);
  assert.ok(out.length <= 30, `折叠后长度 ${out.length} 应 ≤ 30`);
  assert.ok(out.includes("…"));
});

await run("itemUtils");

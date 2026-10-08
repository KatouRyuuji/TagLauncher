import { assert, test, run } from "./__testutil";
import { planBatchRename, splitName, type BatchRenameRule } from "./batchRename";
import type { Item } from "../types";

// planBatchRename：规则只作用于主文件名（可选含扩展名），序号按输入顺序且跳过失效对象，
// 同目录新名称不区分大小写重复时全部标为批内重名。

function item(id: number, name: string, extra: Partial<Item> = {}): Pick<Item, "id" | "name" | "path" | "type" | "is_missing"> {
  return { id, name, path: `D:\\dir\\${name}`, type: "exe", is_missing: false, ...extra };
}

const replace = (find: string, replaceWith: string, opts: Partial<Extract<BatchRenameRule, { kind: "replace" }>> = {}): BatchRenameRule => ({
  kind: "replace", find, replace: replaceWith, regex: false, caseSensitive: false, includeExtension: false, ...opts,
});
const template = (text: string, opts: Partial<Extract<BatchRenameRule, { kind: "template" }>> = {}): BatchRenameRule => ({
  kind: "template", template: text, start: 1, pad: 0, includeExtension: false, ...opts,
});
const names = (rule: BatchRenameRule, items: ReturnType<typeof item>[]) => planBatchRename(items, rule).rows.map((r) => r.newName);

test("splitName：文件拆出扩展名，文件夹、无扩展名与点开头的名称整体为主名", () => {
  assert.deepEqual(splitName("a.b.txt", false), ["a.b", ".txt"]);
  assert.deepEqual(splitName("README", false), ["README", ""]);
  assert.deepEqual(splitName(".env", false), [".env", ""]);
  assert.deepEqual(splitName("v1.2", true), ["v1.2", ""]);
});

test("普通查找替换：全部匹配处替换，默认不区分大小写，不改扩展名", () => {
  assert.deepEqual(names(replace("txt", "X"), [item(1, "TXT-txt.txt")]), ["X-X.txt"]);
  assert.deepEqual(names(replace("txt", "X", { caseSensitive: true }), [item(1, "TXT-txt.txt")]), ["TXT-X.txt"]);
});

test("普通查找替换：替换文本里的 $ 与正则元字符按字面处理", () => {
  assert.deepEqual(names(replace("a.b", "$1"), [item(1, "a.b-axb.txt")]), ["$1-axb.txt"]);
});

test("正则替换：支持 $1 分组引用与 ^ 前缀插入", () => {
  assert.deepEqual(names(replace("(\\d+)-(\\w+)", "$2_$1", { regex: true }), [item(1, "01-intro.mp4")]), ["intro_01.mp4"]);
  assert.deepEqual(names(replace("^", "新-", { regex: true }), [item(1, "a.txt")]), ["新-a.txt"]);
});

test("正则有误时返回提示，所有行保持原名", () => {
  const plan = planBatchRename([item(1, "a.txt")], replace("(", "x", { regex: true }));
  assert.ok(plan.error?.startsWith("正则表达式有误"));
  assert.deepEqual(plan.rows.map((r) => [r.newName, r.status]), [["a.txt", "unchanged"]]);
});

test("查找内容为空时不改名", () => {
  assert.deepEqual(planBatchRename([item(1, "a.txt")], replace("", "x")).rows[0].status, "unchanged");
});

test("同时修改扩展名：规则作用于完整名称", () => {
  assert.deepEqual(names(replace(".jpeg", ".jpg", { includeExtension: true }), [item(1, "p.jpeg")]), ["p.jpg"]);
  assert.deepEqual(names(replace(".jpeg", ".jpg"), [item(1, "p.jpeg")]), ["p.jpeg"]);
});

test("模板：{name} 为原主文件名，{n} 按输入顺序编号并补零", () => {
  const items = [item(1, "b.png"), item(2, "a.png"), item(3, "c")];
  assert.deepEqual(names(template("{name}-{n}", { start: 9, pad: 2 }), items), ["b-09.png", "a-10.png", "c-11"]);
});

test("模板勾选同时修改扩展名时，结果即完整新名称，{name} 仍为主文件名", () => {
  assert.deepEqual(names(template("{name}.bak", { includeExtension: true }), [item(1, "a.txt")]), ["a.bak"]);
});

test("文件夹的名称整体视为主名", () => {
  assert.deepEqual(names(template("{name}_{n}"), [item(1, "v1.2", { type: "folder" })]), ["v1.2_1"]);
});

test("失效对象标为 missing 且不占序号", () => {
  const plan = planBatchRename([item(1, "a.txt", { is_missing: true }), item(2, "b.txt")], template("f{n}"));
  assert.deepEqual(plan.rows.map((r) => [r.newName, r.status]), [["a.txt", "missing"], ["f1.txt", "rename"]]);
});

test("名称未变（含模板只输出 {name}）标为 unchanged，只改大小写算改名", () => {
  const plan = planBatchRename([item(1, "a.txt"), item(2, "b.txt")], replace("b", "B", { caseSensitive: true }));
  assert.deepEqual(plan.rows.map((r) => r.status), ["unchanged", "rename"]);
  assert.equal(planBatchRename([item(1, "a.txt")], template("{name}")).rows[0].status, "unchanged");
});

test("同目录新名称不区分大小写重复时全部标为批内重名；不同目录、新名互不相同都不算重复", () => {
  const plan = planBatchRename([item(1, "a1.txt"), item(2, "A2.txt"), item(3, "a3.txt", { path: "D:\\other\\a3.txt" })], replace("\\d", "", { regex: true }));
  assert.deepEqual(plan.rows.map((r) => r.status), ["duplicate", "duplicate", "rename"]);
  // 新名互不相同时不算批内重名；目标被同批或批外对象占用由后端 dry_run 判断
  const distinct = planBatchRename([item(1, "left.txt"), item(2, "right.txt")], template("{name}-x"));
  assert.deepEqual(distinct.rows.map((r) => r.status), ["rename", "rename"]);
  const both = planBatchRename([item(1, "a.txt"), item(2, "b.txt")], replace("[ab]", "z", { regex: true }));
  assert.deepEqual(both.rows.map((r) => r.status), ["duplicate", "duplicate"]);
});

await run("batchRename");

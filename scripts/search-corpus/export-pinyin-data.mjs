// ============================================================================
// scripts/search-corpus/export-pinyin-data.mjs — 导出 Rust 拼音模块的词典数据
// ----------------------------------------------------------------------------
// 来源：pinyin-pro（MIT，https://github.com/zh-lx/pinyin-pro），版本见 package-lock。
// 只导出搜索用到的两种调用（toneType:"none" 全拼 / pattern:"first" 首字母，surname 关闭）
// 所需的数据，并在导出时就去掉声调（与 pinyin-pro 的 getPinyinWithoutTone 同一实现）：
//   [chars]    单字 → 第一个读音（去调）
//   [words]    多字词 → 逐字读音（去调，空格分隔）、概率；已按 pinyin-pro 的
//              insertPattern 规则在同词多来源里选出胜者、剔除姓氏词典
// 用法：node scripts/search-corpus/export-pinyin-data.mjs
// ============================================================================
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const esm = path.join(root, "node_modules/pinyin-pro/dist/esm");
const imp = (p) => import(path.join(esm, p));

const DICT1 = (await imp("data/dict1.mjs")).default;
const { PatternsNormal } = await imp("data/patterns.mjs");
const { Priority } = await imp("common/constant.mjs");
const { getPinyinWithoutTone } = await imp("core/pinyin/handle.mjs");
const version = JSON.parse(readFileSync(path.join(root, "node_modules/pinyin-pro/package.json"), "utf8")).version;

const chars = [];
DICT1.NumberDICT.forEach((v, code) => {
  if (v) chars.push([String.fromCharCode(code), v]);
});
for (const [k, v] of DICT1.StringDICT) chars.push([k, v]);
chars.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

// 复刻 AC.insertPattern 的同节点排序，再按 surname:"off" 取第一个非姓氏模式
const byWord = new Map();
for (const pattern of PatternsNormal) {
  const list = byWord.get(pattern.zh) ?? [];
  let placed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if ((pattern.priority === p.priority && pattern.probability >= p.probability) || pattern.priority > p.priority) {
      list[i + 1] = p;
    } else {
      list[i + 1] = pattern;
      placed = true;
      break;
    }
  }
  if (!placed) list[0] = pattern;
  byWord.set(pattern.zh, list);
}
const words = [];
for (const [zh, list] of byWord) {
  const win = list.find((p) => p.priority !== Priority.Surname);
  if (!win) continue;
  if (win.priority !== Priority.Normal) throw new Error(`未预期的优先级 ${zh}`);
  if ([...zh].length !== win.length || win.length < 2) throw new Error(`未预期的词长 ${zh}`);
  const py = win.pinyin.split(" ").map((s) => getPinyinWithoutTone(s));
  words.push([zh, py.join(" "), String(win.probability)]);
}
words.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const check = (s) => {
  if (/[\t\n]/.test(s)) throw new Error(`数据含制表/换行：${JSON.stringify(s)}`);
  return s;
};
const lines = [
  `# 由 scripts/search-corpus/export-pinyin-data.mjs 从 pinyin-pro ${version} 导出（MIT License, Copyright (c) zh-lx）。勿手改。`,
  "[chars]",
  ...chars.map(([c, v]) => `${check(c)}\t${check(getPinyinWithoutTone(v.split(" ")[0]))}`),
  "[words]",
  ...words.map((w) => w.map(check).join("\t")),
  "",
];
const out = path.join(root, "src-tauri/src/search/pinyin_data.txt");
writeFileSync(out, lines.join("\n"));
console.log(`chars=${chars.length} words=${words.length} -> ${path.relative(root, out)}`);

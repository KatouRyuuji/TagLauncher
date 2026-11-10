// ============================================================================
// scripts/search-corpus/gen-corpus.ts — 用旧 TS 搜索实现生成 Rust 搜索的对照语料
// ----------------------------------------------------------------------------
// 一次性生成、提交为 fixture：Rust 端 search 模块逐条比对（同一输入 → 同一组、同一顺序的 id）。
// 生成时使用的是迁移前的 src/lib/search.ts + pinyin-pro；TS 实现删除后此脚本保留作溯源记录，
// 不再可运行（git show <迁移前提交>:src/lib/search.ts 可取回）。
// 用法（迁移前）：npx jiti scripts/search-corpus/gen-corpus.ts
// ============================================================================
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensurePinyin, pinyinSync } from "../../src/lib/pinyinProvider";
import { buildSearchIndex, searchWithIndex } from "../../src/lib/search";
import { runSearchPipeline } from "../../src/lib/searchPipeline";
import { setSynonymGroups } from "../../src/lib/synonyms";
import type { ItemWithTags } from "../../src/types";
import type { SearchMode } from "../../src/stores/appStore";
import type { TypeFilter } from "../../src/lib/itemQuery";

const ROOT = path.resolve(__dirname, "../..");
await ensurePinyin();

// ---------------------------------------------------------------- 确定性随机
let seed = 20261110;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

// ---------------------------------------------------------------- 拼音语料
const pinyinFull = (v: string) => pinyinSync(v, { toneType: "none", type: "array" }).join("");
const pinyinInitials = (v: string) => pinyinSync(v, { pattern: "first", toneType: "none", type: "array" }).join("");

const dataText = readFileSync(path.join(ROOT, "src-tauri/src/search/pinyin_data.txt"), "utf8").split("\n");
const allChars: string[] = [];
const allWords: string[] = [];
let section = "";
for (const line of dataText) {
  if (line.startsWith("#") || !line) continue;
  if (line.startsWith("[")) { section = line; continue; }
  const key = line.split("\t")[0];
  (section === "[chars]" ? allChars : allWords).push(key);
}
const COMMON = "的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坏兴切团哪云音乐银行游戏攻略重庆长城会计行业凭证了解一下一起学习不同不是一样了不起";
const LATIN = ["a", "B", "z", "Q", "1", "9", " ", "-", "_", ".", "é", "Σ", "ü", "🎮", "々", "〇", "了", "一", "不"];

const pinyinTexts = new Set<string>();
for (const w of allWords) pinyinTexts.add(w);
for (let i = 0; i < allChars.length; i += 24) pinyinTexts.add(allChars.slice(i, i + 24).join(""));
for (let n = 0; n < 4000; n += 1) {
  let s = "";
  const len = 1 + Math.floor(rand() * 10);
  for (let k = 0; k < len; k += 1) {
    const r = rand();
    if (r < 0.35) s += pick(allWords);
    else if (r < 0.8) s += COMMON[Math.floor(rand() * COMMON.length)];
    else if (r < 0.9) s += pick(LATIN);
    else s += pick(allChars);
  }
  pinyinTexts.add(s);
}
for (const s of ["", "了", "了解", "好了", "々", "人々", "a々", "一一", "说一说", "不不", "一不了", "重庆重新", "行行行", "银行行长", "Visual Studio", "QQ音乐", "🎮游戏", "長城", "ÄÖÜ ß"]) pinyinTexts.add(s);
const pinyinCases = [...pinyinTexts].map((text) => ({ text, full: pinyinFull(text), initials: pinyinInitials(text) }));

// ---------------------------------------------------------------- 搜索语料
const SYNONYMS = [["游戏", "game"], ["game", "电竞"], ["文档", "Doc", "docs"], ["音乐", "music"], ["照片", "photo", "图片"]];
setSynonymGroups(SYNONYMS);

const BASE_NAMES = [
  "Visual Studio Code", "vscode", "VSCode Insiders", "Blender 4.2", "blender.txt", "node_modules", "README.md", "MyGameLauncher",
  "photo_album-2024", "Adobe Photoshop CC", "QQ音乐", "网易云音乐", "Steam", "League of Legends", "café notes", "Ελληνικά ΣΟΦΟΣ",
  "重庆攻略", "银行流水", "长城宽带", "音乐播放器", "行业报告", "会计凭证", "了解一下", "一起学习", "不同版本", "重要文档",
  "周杰伦 - 晴天", "游戏截图", "工作周报", "财务报表 2023", "项目文档", "设计稿 v2", "会议纪要", "壁纸合集", "数据备份",
  "工具箱", "源码", "terminal", "browser", "notes", "report final", "Report-Draft", "game launcher", "music player",
  "Docker Desktop", "docs", "Microsoft Word", "word_count.py", "build.bat", "deploy.ps1", "Node.js", "nodejs-installer",
  "Chrome", "chromium", "Firefox Developer", "Git Bash", "github desktop", "TagLauncher", "tag-launcher", "tag_launcher",
  "人々の暮らし", "ひらがな", "カタカナ", "한국어", "🎮 游戏合集", "长沙旅行", "行政区划", "银行卡", "朝阳区", "单车", "重新开始",
];
const TAGS = [
  { id: 1, name: "工作" }, { id: 2, name: "游戏" }, { id: 3, name: "Music" }, { id: 4, name: "照片" }, { id: 5, name: "dev-tools" },
  { id: 6, name: "重要" }, { id: 7, name: "银行" }, { id: 8, name: "长期" }, { id: 9, name: "Archive" }, { id: 10, name: "读书笔记" },
  { id: 11, name: "VideoEdit" }, { id: 12, name: "临时" },
];
const ALIASES = ["我的代码", "写作", "bank", "老游戏", "主力浏览器", "Work Notes", "重庆", "长城", "vsc", "music"];
const NOTES = ["备忘：每周一更新", "password is in vault", "重要：不要删除", "game save files", "长期保存", "来自旧电脑", "TODO cleanup", "音乐收藏"];
const DIRS = ["C:\\Users\\feng\\Desktop", "D:\\Games", "E:\\资料\\工作", "C:\\Program Files\\Tools", "D:\\Music\\华语", "F:\\照片\\2024", "c:/dev/projects", "\\\\nas\\share\\docs"];
const TYPES: ItemWithTags["type"][] = ["folder", "image", "audio", "video", "text", "exe", "bat", "ps1"];

const items: ItemWithTags[] = [];
let id = 1;
for (const base of BASE_NAMES) {
  const copies = 1 + Math.floor(rand() * 4);
  for (let c = 0; c < copies; c += 1) {
    const name = c === 0 ? base : `${base} ${c + 1}`;
    const tags = TAGS.filter(() => chance(0.15));
    items.push({
      id: id,
      name,
      path: `${pick(DIRS)}\\${chance(0.3) ? pick(BASE_NAMES) + "\\" : ""}${name}`,
      type: pick(TYPES),
      created_at: "2024-01-01 00:00:00",
      is_favorite: chance(0.15),
      is_missing: chance(0.1),
      note: chance(0.2) ? pick(NOTES) : chance(0.1) ? "" : null,
      alias: chance(0.12) ? pick(ALIASES) : chance(0.05) ? "  " : null,
      tags,
    });
    id += 1;
  }
}
// 打乱顺序：索引顺序 ≠ id 顺序，检查「桶内保持索引原顺序」
for (let i = items.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}

const queries = new Set<string>([
  "", " ", "@", "@ ", "v", "vs", "vsc", "vsco", "vscode", "VSC", "visual", "visaul", "vsiual", "studio", "stdio", "code", "cod",
  "blender", "blendr", "blendre", "blnder", "bledner", "node", "bode", "nod", "nodee", "readme", "photo", "fotos", "phot", "album",
  "adobe", "ps", "pscc", "qq", "qqyy", "yinyue", "yy", "music", "steam", "lol", "league", "legnds", "cafe", "café", "σοφος", "ελλ",
  "chongqing", "cq", "zhongqing", "zq", "yinhang", "yh", "yinxing", "changcheng", "cc", "zhangcheng", "kuandai", "yinyuebofangqi",
  "hangye", "xingye", "hy", "kuaiji", "kj", "huiji", "liaojie", "lj", "lejie", "yiqi", "yq", "butong", "bt", "zhongyao", "zy",
  "zhoujielun", "zjl", "晴天", "qingtian", "游戏", "youxi", "yx", "game", "电竞", "dianjing", "文档", "doc", "docs", "Doc", "wendang",
  "音乐", "照片", "图片", "photo album", "工作", "gz", "gongzuo", "周报", "zb", "财务", "cwbb", "2023", "项目", "xmwd", "设计", "sjg",
  "会议", "hyjy", "壁纸", "bizhi", "sjbf", "工具", "gjx", "源码", "ym", "term", "termnial", "brow", "browsr", "note", "notes", "rep",
  "report", "repotr", "draft", "gl", "gamelauncher", "mp", "dd", "docker", "word", "wc", "word_count", "build", "bat", "deploy", "ps1",
  "node.js", "nodejs", "chrome", "chrom", "chromuim", "ff", "fd", "firefox", "git", "gb", "github", "gd", "tag", "ag", "tl", "taglauncher",
  "tag-launcher", "tag_launcher", "launcher", "人々", "renren", "ひら", "カタ", "한국", "🎮", "长沙", "changsha", "zhangsha", "cs", "行政",
  "xingzheng", "hangzheng", "银行卡", "yhk", "朝阳", "chaoyang", "zhaoyang", "单车", "danche", "shanche", "重新", "chongxin",
  "zhongxin", "cx", "users", "feng", "desktop", "games", "资料", "zl", "program", "tools", "华语", "hy", "2024", "dev", "projects",
  "nas", "share", "c:", "d:\\games", "e:\\", "我的", "wdd", "写作", "bank", "老游戏", "主力", "work notes", "wn", "备忘", "vault",
  "password", "不要删除", "save", "长期", "旧电脑", "todo", "cleanup", "收藏", "重要", "银行", "music", "dev-tools", "dt", "archive",
  "读书", "dsbj", "videoedit", "ve", "临时", "ls",
  "vsc && code", "vsc&&code", "游戏 || 音乐", "游戏||音乐", "游戏 音乐", "游戏  音乐", "game !! 截图", "game!!截图", "!!游戏", "!! 游戏",
  "(游戏 || 音乐) && 重要", "(vsc || blender) !! 2", "a!!b!!c", "report !! final !! draft", "游戏 || !!音乐", "vsc && !!insiders",
  "tag&&", "&&tag", "||", "&&", "!!", "()", "(", ")", "(游戏", "游戏)", "@游戏", "@游戏合集", "@vscode", "@ vscode", "@VSCODE", "@重庆攻略",
  "@game", "@音乐 || @steam", "vsc @code", "@@", "@ @", "x || ", " || x", "tag || 忍者", "tag ||忍者", "tag|| 忍者", "a  &&  b",
  "工作 && 重要 !! 临时", "( 重要 )", "((重要))", "!!(游戏 || 音乐)", "!!!", "!!!!游戏", "&&&", "|||", "vsc\tcode", "vsc\u3000code",
  "\u00a0vsc", "vsc\u00a0", "ab", "a", "z", "zz", "xyz", "1", "12", "v2", "4.2", ".txt", "txt", "md", "py", "_", "-", ".", "\\", "/",
]);
// 每个名称自动派生：前缀、全拼/首字母前缀、错字（删/替/换/插）
const mutate = (s: string): string[] => {
  const out: string[] = [];
  if (s.length < 3) return out;
  const i = 1 + Math.floor(rand() * (s.length - 1));
  out.push(s.slice(0, i) + s.slice(i + 1));
  out.push(s.slice(0, i) + "x" + s.slice(i + 1));
  if (i + 1 < s.length) out.push(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
  out.push(s.slice(0, i) + "e" + s.slice(i));
  return out;
};
for (const base of BASE_NAMES) {
  const lower = base.toLowerCase();
  for (const n of [1, 2, 3, 5]) if (lower.length >= n) queries.add(lower.slice(0, n));
  const full = pinyinFull(base).toLowerCase().trim();
  const ini = pinyinInitials(base).toLowerCase().trim();
  for (const n of [2, 4, 7]) if (full.length >= n) queries.add(full.slice(0, n));
  if (ini.length >= 2) queries.add(ini.slice(0, Math.min(ini.length, 3)));
  for (const m of mutate(lower.split(/\s+/)[0])) queries.add(m);
  if (/[a-z]{4,}/.test(full)) for (const m of mutate(full.slice(0, 6))) queries.add(m);
}

// 切片可能把 🎮 之类的代理对切开：Rust 侧字符串必为合法 UTF-8，这类查询不可能出现，剔除
for (const q of [...queries]) if (!q.isWellFormed()) queries.delete(q);

const MODES: SearchMode[] = ["all", "name", "tag"];
const cases: Array<{ q: string; mode: SearchMode; ids: number[] }> = [];
for (const mode of MODES) {
  const index = buildSearchIndex(items, mode);
  for (const q of queries) cases.push({ q, mode, ids: searchWithIndex(index, q).map((it) => it.id) });
}
const FILTERS: TypeFilter[] = ["all", "folder", "image", "audio", "video", "text", "exe", "script"];
const pipelineCases: Array<{ q: string; mode: SearchMode; typeFilter: TypeFilter; hideMissing: boolean; ids: number[] }> = [];
const sampleQueries = ["vsc", "游戏", "yx", "game || 音乐", "report", "", "a", "!!游戏", "c:", "重要"];
for (const typeFilter of FILTERS) {
  for (const hideMissing of [false, true]) {
    for (const q of sampleQueries) {
      const mode = pick(MODES);
      const index = buildSearchIndex(items, mode);
      pipelineCases.push({ q, mode, typeFilter, hideMissing, ids: runSearchPipeline(index, q, { typeFilter, hideMissing }).map((it) => it.id) });
    }
  }
}

const out = {
  generatedBy: "scripts/search-corpus/gen-corpus.ts（迁移前 TS 实现 src/lib/search.ts + pinyin-pro）",
  synonyms: SYNONYMS,
  items: items.map((it) => ({
    id: it.id, name: it.name, path: it.path, type: it.type, alias: it.alias ?? null, note: it.note ?? null,
    is_favorite: it.is_favorite, is_missing: Boolean(it.is_missing), tags: it.tags.map((t) => t.name),
  })),
  cases,
  pipelineCases,
};
const fixtures = path.join(ROOT, "src-tauri/tests/fixtures");
writeFileSync(path.join(fixtures, "search_corpus.json"), JSON.stringify(out));
writeFileSync(path.join(fixtures, "pinyin_corpus.json"), JSON.stringify({ generatedBy: "pinyin-pro（toneType none / pattern first, array join）", cases: pinyinCases }));
const hits = cases.filter((c) => c.ids.length > 0 && c.ids.length < items.length).length;
console.log(`items=${items.length} search cases=${cases.length} (非空非全量 ${hits}) pipeline=${pipelineCases.length} pinyin=${pinyinCases.length}`);

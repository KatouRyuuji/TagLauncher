import { pinyin } from "pinyin-pro";
import type { ItemWithTags } from "../types";
import type { SearchMode } from "../stores/appStore";
import { expandQuery } from "./synonyms";

interface SearchIndexEntry {
  item: ItemWithTags;
  fields: SearchableFields;
}

interface SearchableFields {
  nameEntry: SearchableText;
  pathWithoutDrive: string;
  tagEntries: SearchableText[];
}

interface SearchableText {
  name: string;
  pinyinName: string;
  pinyinInitials: string;
  englishName: EnglishNameFields;
}

/**
 * 英文分词派生字段：按空白/连字符/下划线/驼峰边界切词，
 * 供英文首字母缩写（vsc）与连写子序列（vscode）两类弱匹配使用。
 */
interface EnglishNameFields {
  /** 各词首字母串（仅字母开头的词参与）："Visual Studio Code 2022" → "vsc" */
  initials: string;
  /** 参与词的小写连写串："Visual Studio Code 2022" → "visualstudiocode" */
  compact: string;
  /** compact 中各词的起始下标（升序），子序列匹配的词首约束依据 */
  wordStarts: number[];
}

/** 匹配强度：0=不命中；1=弱命中（英文缩写/连写子序列）；2=强命中（前缀/拼音/容错/CJK 子串/严格） */
type MatchScore = 0 | 1 | 2;

export interface SearchIndex {
  entries: SearchIndexEntry[];
  mode: SearchMode;
}

// 拼音字段缓存：按对象 id 键控而非对象身份。loadAll 全量刷新后所有对象换新引用，
// WeakMap 会全 miss 导致主线程全量重算拼音；按 id + 内容指纹（名称/路径/标签）校验
// 即可跨刷新复用。标签指纹随条目保存，内容变了自然重算。
interface SearchFieldsCacheEntry {
  name: string;
  path: string;
  tagsKey: string;
  fields: SearchableFields;
}

const searchFieldsCache = new Map<number, SearchFieldsCacheEntry>();
/** 缓存上限：超限淘汰最旧一半（保留热点），同时避免对象删除后条目长期残留 */
const SEARCH_FIELDS_CACHE_LIMIT = 20000;
const queryExprCache = new Map<string, Expr | null>();

type Token =
  | { type: "term"; value: string; strict: boolean }
  | { type: "and" | "or" | "not" | "lparen" | "rparen" };

type Expr =
  | { type: "term"; value: string; strict: boolean }
  | { type: "and" | "or" | "exclude"; left: Expr; right: Expr };

function toPinyinText(value: string): string {
  return pinyin(value, { toneType: "none", type: "array" }).join("");
}

function toPinyinInitials(value: string): string {
  return pinyin(value, { pattern: "first", toneType: "none", type: "array" }).join("");
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const EMPTY_ENGLISH_FIELDS: EnglishNameFields = { initials: "", compact: "", wordStarts: [] };

/** 名称含拉丁字母时才构建派生字段；纯 CJK 名称的缩写匹配永远落空，跳过构建 */
function deriveEnglishFields(name: string): EnglishNameFields {
  if (!/[a-zA-Z]/.test(name)) return EMPTY_ENGLISH_FIELDS;
  const words = name
    .split(/[\s_-]+|(?<=[a-z])(?=[A-Z])/)
    .filter((word) => /^[a-zA-Z]/.test(word));
  if (words.length === 0) return EMPTY_ENGLISH_FIELDS;
  let initials = "";
  let compact = "";
  const wordStarts: number[] = [];
  for (const word of words) {
    initials += word[0].toLowerCase();
    wordStarts.push(compact.length);
    compact += word.toLowerCase();
  }
  return { initials, compact, wordStarts };
}

function createSearchEntry(item: ItemWithTags): SearchIndexEntry {
  const tagsKey = item.tags.map((tag) => `${tag.id}:${tag.name}`).join("|");
  const cached = searchFieldsCache.get(item.id);
  if (cached && cached.name === item.name && cached.path === item.path && cached.tagsKey === tagsKey) {
    // 命中即刷新热度（Map 按插入序迭代，重插移到最新位），超限淘汰才落在真正冷门的条目上
    searchFieldsCache.delete(item.id);
    searchFieldsCache.set(item.id, cached);
    return { item, fields: cached.fields };
  }

  const tagEntries = item.tags.map((tag) => ({
    name: tag.name,
    pinyinName: toPinyinText(tag.name),
    pinyinInitials: toPinyinInitials(tag.name),
    englishName: deriveEnglishFields(tag.name),
  }));

  const fields = {
    nameEntry: {
      name: item.name,
      pinyinName: toPinyinText(item.name),
      pinyinInitials: toPinyinInitials(item.name),
      englishName: deriveEnglishFields(item.name),
    },
    // 去盘符路径随拼音一起缓存（与 scoreName 的弱辅助匹配一致），避免每次匹配重跑正则
    pathWithoutDrive: item.path.replace(/^[a-z]:[\\/]+/i, ""),
    tagEntries,
  };

  if (searchFieldsCache.size >= SEARCH_FIELDS_CACHE_LIMIT) {
    // 超限淘汰最旧一半：Map 按插入序迭代，头部即最冷条目（整体 clear 会连热点一起清掉）
    let evictCount = Math.floor(SEARCH_FIELDS_CACHE_LIMIT / 2);
    for (const key of searchFieldsCache.keys()) {
      if (evictCount <= 0) break;
      searchFieldsCache.delete(key);
      evictCount -= 1;
    }
  }
  searchFieldsCache.set(item.id, { name: item.name, path: item.path, tagsKey, fields });

  return {
    item,
    fields,
  };
}

/**
 * 按选中标签筛选（AND 交集）。
 * 传入 `expand` 时支持图状层级：每个选中标签的命中条件 = 对象拥有 {该标签 ∪ 其后代} 中任一标签
 * （选中父标签即并入所有后代对象）；不传 `expand` 时退化为精确标签匹配。
 */
export function filterItemsByTags(
  items: ItemWithTags[],
  selectedTagIds: number[],
  expand?: (tagId: number) => Set<number>,
): ItemWithTags[] {
  if (selectedTagIds.length === 0) return items;
  return items.filter((item) =>
    selectedTagIds.every((tid) => {
      const allowed = expand ? expand(tid) : null;
      return allowed
        ? item.tags.some((t) => allowed.has(t.id))
        : item.tags.some((t) => t.id === tid);
    }),
  );
}

export function buildSearchIndex(items: ItemWithTags[], mode: SearchMode): SearchIndex {
  return {
    entries: items.map(createSearchEntry),
    mode,
  };
}

/** 在已有索引上按对象 id 过滤，避免标签切换时重复计算拼音字段。 */
export function filterSearchIndex(index: SearchIndex, allowedIds: Set<number>): SearchIndex {
  if (allowedIds.size === index.entries.length) {
    let allPresent = true;
    for (const entry of index.entries) {
      if (!allowedIds.has(entry.item.id)) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) return index;
  }
  return {
    mode: index.mode,
    entries: index.entries.filter((entry) => allowedIds.has(entry.item.id)),
  };
}

function pushTerm(tokens: Token[], raw: string): void {
  const value = raw.trim();
  if (!value) return;

  if (value.startsWith("@")) {
    const strictValue = value.slice(1).trim();
    if (strictValue) {
      tokens.push({ type: "term", value: strictValue, strict: true });
    }
    return;
  }

  tokens.push({ type: "term", value, strict: false });
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let buffer = "";

  for (let i = 0; i < query.length; i += 1) {
    const rest = query.slice(i);

    if (rest.startsWith("&&")) {
      pushTerm(tokens, buffer);
      buffer = "";
      tokens.push({ type: "and" });
      i += 1;
      continue;
    }

    if (rest.startsWith("||")) {
      pushTerm(tokens, buffer);
      buffer = "";
      tokens.push({ type: "or" });
      i += 1;
      continue;
    }

    if (rest.startsWith("!!")) {
      pushTerm(tokens, buffer);
      buffer = "";
      tokens.push({ type: "not" });
      i += 1;
      continue;
    }

    const char = query[i];
    if (char === "(" || char === ")") {
      pushTerm(tokens, buffer);
      buffer = "";
      tokens.push({ type: char === "(" ? "lparen" : "rparen" });
      continue;
    }

    if (/\s/.test(char)) {
      pushTerm(tokens, buffer);
      buffer = "";
      // 预读跳过连续空白：若下一个非空白处是显式操作符（&&/||/!!）或右括号，
      // 不插入隐式 or。否则隐式 or 与紧随的显式 || 会形成连续两个 or，被末尾
      // 过滤逻辑一并删除，导致查询后半段丢失（如 "tag || 忍者" 只剩 "tag"）。
      let nextNonSpace = i;
      while (nextNonSpace + 1 < query.length && /\s/.test(query[nextNonSpace + 1])) {
        nextNonSpace += 1;
      }
      const upcoming = query.slice(nextNonSpace + 1);
      const nextIsExplicitOp =
        upcoming.startsWith("&&") ||
        upcoming.startsWith("||") ||
        upcoming.startsWith("!!") ||
        upcoming.startsWith(")");
      if (
        !nextIsExplicitOp &&
        tokens.length > 0 &&
        tokens[tokens.length - 1].type !== "or"
      ) {
        tokens.push({ type: "or" });
      }
      continue;
    }

    buffer += char;
  }

  pushTerm(tokens, buffer);
  return tokens.filter((token, index, all) => {
    if (token.type !== "or") return true;
    const prev = all[index - 1]?.type;
    const next = all[index + 1]?.type;
    return prev === "term" || prev === "rparen"
      ? next === "term" || next === "lparen" || next === "not"
      : false;
  });
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr | null {
    const expr = this.parseExclude();
    return expr;
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(type: Token["type"]): boolean {
    if (this.current()?.type !== type) return false;
    this.index += 1;
    return true;
  }

  private parseExclude(): Expr | null {
    let expr: Expr | null = null;

    if (this.consume("not")) {
      const right = this.parseExclude();
      return right ? { type: "exclude", left: { type: "term", value: "", strict: false }, right } : null;
    }

    expr = this.parseOr();
    // 左结合：A!!B!!C 解析为 ((A−B)−C)，依次做差集，避免右结合带来的错误保留
    while (this.consume("not")) {
      const right = this.parseOr();
      if (!expr || !right) return expr;
      expr = { type: "exclude", left: expr, right };
    }

    return expr;
  }

  private parseOr(): Expr | null {
    let expr = this.parseAnd();
    while (this.consume("or")) {
      const right = this.parseAnd();
      if (!expr || !right) return expr ?? right;
      expr = { type: "or", left: expr, right };
    }
    return expr;
  }

  private parseAnd(): Expr | null {
    let expr = this.parsePrimary();
    while (this.consume("and")) {
      const right = this.parsePrimary();
      if (!expr || !right) return expr ?? right;
      expr = { type: "and", left: expr, right };
    }
    return expr;
  }

  private parsePrimary(): Expr | null {
    const token = this.current();
    if (!token) return null;

    // 一元排除：!! 可出现在 ||/&& 的操作数位置（如 A||!!B 表示 A 与「全集减 B」的并集）。
    // 缺了这一层，parseOr/parseAnd 拿到 not token 会返回 null，直接丢掉右侧整个分支。
    if (token.type === "not") {
      this.index += 1;
      const right = this.parsePrimary();
      return right
        ? { type: "exclude", left: { type: "term", value: "", strict: false }, right }
        : null;
    }

    if (token.type === "term") {
      this.index += 1;
      return { type: "term", value: token.value, strict: token.strict };
    }

    if (this.consume("lparen")) {
      const expr = this.parseExclude();
      this.consume("rparen");
      return expr;
    }

    return null;
  }
}

function parseQuery(query: string): Expr | null {
  const cached = queryExprCache.get(query);
  if (cached !== undefined) {
    // 命中即刷新热度（Map 按插入序迭代，重插移到最新位）
    queryExprCache.delete(query);
    queryExprCache.set(query, cached);
    return cached;
  }

  const tokens = tokenize(query);
  const expr = tokens.length === 0 ? null : new Parser(tokens).parse();

  // 尾部淘汰最老条目，保留热点（原实现超限整体 clear，连热点一起清掉）
  while (queryExprCache.size >= 128) {
    const oldest = queryExprCache.keys().next();
    if (oldest.done) break;
    queryExprCache.delete(oldest.value);
  }
  queryExprCache.set(query, expr);

  return expr;
}

function isEnglishTypoMatch(source: string, query: string): boolean {
  if (query.length < 3) return false;
  if (!/^[a-z0-9_.-]+$/.test(source) || !/^[a-z0-9_.-]+$/.test(query)) {
    return false;
  }

  const sourcePrefix = source.slice(0, Math.max(query.length, 1));
  if (Math.abs(sourcePrefix.length - query.length) > 1) return false;

  // 短词（<5 字母）收紧：不允许首字母替换，要求切片首字符与查询首字符一致，避免 bode→node 之类误命中
  if (query.length < 5 && sourcePrefix[0] !== query[0]) return false;

  let prev = Array.from({ length: query.length + 1 }, (_, i) => i);
  for (let i = 1; i <= sourcePrefix.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= query.length; j += 1) {
      const cost = sourcePrefix[i - 1] === query[j - 1] ? 0 : 1;
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev = next;
  }

  return prev[query.length] <= 1;
}

/** CJK 统一表意文字与假名：命中即按子串匹配（见 prefixMatches） */
const CJK_QUERY_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

function prefixMatches(value: string, query: string): boolean {
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  if (normalizedValue.startsWith(normalizedQuery)) return true;
  // CJK 查询按子串匹配：中文对象名常以品牌/艺术家等前缀开头（如「周杰伦 - 晴天」），
  // 仅前缀匹配会漏掉名称中后段的命中；拼音/首字母通道仍保持前缀匹配以控制噪声。
  if (CJK_QUERY_RE.test(normalizedQuery) && normalizedValue.includes(normalizedQuery)) return true;
  return isEnglishTypoMatch(normalizedValue, normalizedQuery);
}

function strictMatches(value: string, query: string): boolean {
  return normalize(value) === normalize(query);
}

/** 缩写弱匹配的查询门槛：纯小写字母且长度 ≥2（单字母与含数字/符号的查询噪声过大，不参与） */
const ENGLISH_ABBR_QUERY_RE = /^[a-z]{2,}$/;

/**
 * 连写串上的子序列匹配：每个查询字符要么紧邻上一次命中（词内连写，如 vscode 的 ode），
 * 要么落在词首（跨词跳跃，如 vscode 的 v、s、c）。词内部跳字（如 ag 之于 tag）不命中。
 */
function isCompactSubsequence(fields: EnglishNameFields, query: string): boolean {
  const { compact, wordStarts } = fields;
  let prevHit = -1;
  for (const ch of query) {
    let hit = -1;
    for (let i = prevHit + 1; i < compact.length; i += 1) {
      if (compact[i] !== ch) continue;
      if (i === prevHit + 1 || wordStarts.includes(i)) {
        hit = i;
        break;
      }
    }
    if (hit === -1) return false;
    prevHit = hit;
  }
  return true;
}

/** 英文缩写弱命中：首字母串前缀（vsc）或连写串子序列（vscode） */
function scoreEnglishAbbrev(fields: EnglishNameFields, query: string): MatchScore {
  const q = normalize(query);
  if (fields.compact === "" || !ENGLISH_ABBR_QUERY_RE.test(q)) return 0;
  if (fields.initials.startsWith(q)) return 1;
  return isCompactSubsequence(fields, q) ? 1 : 0;
}

function scoreText(text: SearchableText, query: string, strict: boolean): MatchScore {
  if (strict) return strictMatches(text.name, query) ? 2 : 0;

  if (
    prefixMatches(text.name, query) ||
    prefixMatches(text.pinyinName, query) ||
    prefixMatches(text.pinyinInitials, query)
  ) {
    return 2;
  }
  // 强通道全落空才走英文缩写弱匹配；弱命中在结果排序中低于强命中
  return scoreEnglishAbbrev(text.englishName, query);
}

function scoreName(entry: SearchIndexEntry, query: string, strict: boolean): MatchScore {
  const score = scoreText(entry.fields.nameEntry, query, strict);
  if (strict || score === 2) return score;

  // path 作为弱辅助字段：使用 createSearchEntry 缓存的去盘符路径，降低单个盘符字母的噪声命中。
  // path 前缀命中属既有语义，计强命中；仅英文缩写/连写子序列两个新通道计弱命中。
  return prefixMatches(entry.fields.pathWithoutDrive, query) ? 2 : score;
}

function scoreTag(entry: SearchIndexEntry, query: string, strict: boolean): MatchScore {
  let best: MatchScore = 0;
  for (const tag of entry.fields.tagEntries) {
    const score = scoreText(tag, query, strict);
    if (score === 2) return 2;
    if (score > best) best = score;
  }
  return best;
}

function scoreTerm(entry: SearchIndexEntry, query: string, mode: SearchMode, strict: boolean): MatchScore {
  if (!query.trim()) return 2;

  const queries = strict ? [query] : expandQuery(query);

  let best: MatchScore = 0;
  for (const term of queries) {
    const score =
      mode === "name"
        ? scoreName(entry, term, strict)
        : mode === "tag"
          ? scoreTag(entry, term, strict)
          : (Math.max(scoreName(entry, term, strict), scoreTag(entry, term, strict)) as MatchScore);
    if (score === 2) return 2;
    if (score > best) best = score;
  }
  return best;
}

function scoreExpr(entry: SearchIndexEntry, expr: Expr, mode: SearchMode): MatchScore {
  if (expr.type === "term") {
    return scoreTerm(entry, expr.value, mode, expr.strict);
  }

  if (expr.type === "and") {
    const left = scoreExpr(entry, expr.left, mode);
    // 左支落空即整体落空（短路）；两侧均命中时整体强度取较弱一侧
    return left === 0 ? 0 : (Math.min(left, scoreExpr(entry, expr.right, mode)) as MatchScore);
  }

  if (expr.type === "or") {
    return Math.max(scoreExpr(entry, expr.left, mode), scoreExpr(entry, expr.right, mode)) as MatchScore;
  }

  const left = scoreExpr(entry, expr.left, mode);
  return left > 0 && scoreExpr(entry, expr.right, mode) === 0 ? left : 0;
}

export function searchWithIndex(index: SearchIndex, query: string): ItemWithTags[] {
  const normalized = query.trim();
  if (!normalized) return index.entries.map((entry) => entry.item);

  // 单输 @ 属明确无意义输入（严格前缀后无词项）：返回空而非全量。
  // 其它残缺表达式（如 "tag&&"）保持宽松降级，不崩即可。
  if (normalized === "@") return [];

  const expr = parseQuery(normalized);
  if (!expr) return index.entries.map((entry) => entry.item);

  // 排序契约：收藏绝对置顶（设计 step8）；收藏组与非收藏组内部，强命中排在弱命中
  // （英文缩写/连写子序列）之前，各桶内保持索引原相对顺序（等价稳定排序）。
  // 单趟分桶避免 map→sort→map 的包装/解包与 O(M log M) 排序。
  const favStrong: ItemWithTags[] = [];
  const favWeak: ItemWithTags[] = [];
  const restStrong: ItemWithTags[] = [];
  const restWeak: ItemWithTags[] = [];
  for (const entry of index.entries) {
    const score = scoreExpr(entry, expr, index.mode);
    if (score === 0) continue;
    const bucket = entry.item.is_favorite
      ? score === 2
        ? favStrong
        : favWeak
      : score === 2
        ? restStrong
        : restWeak;
    bucket.push(entry.item);
  }
  return favStrong.concat(favWeak, restStrong, restWeak);
}

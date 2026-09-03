import { pinyin } from "pinyin-pro";
import type { ItemWithTags } from "../types";
import type { SearchMode } from "../stores/appStore";
import { expandQuery } from "./synonyms";

interface SearchIndexEntry {
  item: ItemWithTags;
  fields: SearchableFields;
}

interface SearchableFields {
  pinyinName: string;
  pinyinInitials: string;
  pathWithoutDrive: string;
  tagEntries: SearchableTag[];
}

interface SearchableTag {
  name: string;
  pinyinName: string;
  pinyinInitials: string;
}

export interface SearchIndex {
  entries: SearchIndexEntry[];
  mode: SearchMode;
}

const searchFieldsCache = new WeakMap<ItemWithTags, SearchableFields>();
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

function createSearchEntry(item: ItemWithTags): SearchIndexEntry {
  const cachedFields = searchFieldsCache.get(item);
  if (cachedFields) {
    return { item, fields: cachedFields };
  }

  const tagEntries = item.tags.map((tag) => ({
    name: tag.name,
    pinyinName: toPinyinText(tag.name),
    pinyinInitials: toPinyinInitials(tag.name),
  }));

  const fields = {
    pinyinName: toPinyinText(item.name),
    pinyinInitials: toPinyinInitials(item.name),
    // 去盘符路径随拼音一起缓存（与 matchesName 的弱辅助匹配一致），避免每次匹配重跑正则
    pathWithoutDrive: item.path.replace(/^[a-z]:[\\/]+/i, ""),
    tagEntries,
  };

  searchFieldsCache.set(item, fields);

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

function matchesText(value: string, pinyinValue: string, initialsValue: string, query: string, strict: boolean): boolean {
  if (strict) return strictMatches(value, query);

  return prefixMatches(value, query) ||
    prefixMatches(pinyinValue, query) ||
    prefixMatches(initialsValue, query);
}

function matchesName(entry: SearchIndexEntry, query: string, strict: boolean): boolean {
  if (matchesText(entry.item.name, entry.fields.pinyinName, entry.fields.pinyinInitials, query, strict)) {
    return true;
  }

  // path 作为弱辅助字段：使用 createSearchEntry 缓存的去盘符路径，降低单个盘符字母的噪声命中
  return !strict && prefixMatches(entry.fields.pathWithoutDrive, query);
}

function matchesTag(entry: SearchIndexEntry, query: string, strict: boolean): boolean {
  return entry.fields.tagEntries.some((tag) => matchesText(tag.name, tag.pinyinName, tag.pinyinInitials, query, strict));
}

function matchesTerm(entry: SearchIndexEntry, query: string, mode: SearchMode, strict: boolean): boolean {
  if (!query.trim()) return true;

  const queries = strict ? [query] : expandQuery(query);

  return queries.some((term) => {
    if (mode === "name") return matchesName(entry, term, strict);
    if (mode === "tag") return matchesTag(entry, term, strict);
    return matchesName(entry, term, strict) || matchesTag(entry, term, strict);
  });
}

function evaluateExpr(entry: SearchIndexEntry, expr: Expr, mode: SearchMode): boolean {
  if (expr.type === "term") {
    return matchesTerm(entry, expr.value, mode, expr.strict);
  }

  if (expr.type === "and") {
    return evaluateExpr(entry, expr.left, mode) && evaluateExpr(entry, expr.right, mode);
  }

  if (expr.type === "or") {
    return evaluateExpr(entry, expr.left, mode) || evaluateExpr(entry, expr.right, mode);
  }

  return evaluateExpr(entry, expr.left, mode) && !evaluateExpr(entry, expr.right, mode);
}

export function searchWithIndex(index: SearchIndex, query: string): ItemWithTags[] {
  const normalized = query.trim();
  if (!normalized) return index.entries.map((entry) => entry.item);

  const expr = parseQuery(normalized);
  if (!expr) return index.entries.map((entry) => entry.item);

  // 显式保证收藏置顶（设计 step8）：单趟分组——收藏在前、各组保持原相对顺序（等价稳定排序，
  // 因 index.entries 本就是 source 顺序）。避免 map→sort→map 的包装/解包与 O(M log M) 排序。
  const favs: ItemWithTags[] = [];
  const rest: ItemWithTags[] = [];
  for (const entry of index.entries) {
    if (!evaluateExpr(entry, expr, index.mode)) continue;
    (entry.item.is_favorite ? favs : rest).push(entry.item);
  }
  return favs.concat(rest);
}

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
  const tagEntries = item.tags.map((tag) => ({
    name: tag.name,
    pinyinName: toPinyinText(tag.name),
    pinyinInitials: toPinyinInitials(tag.name),
  }));

  return {
    item,
    fields: {
      pinyinName: toPinyinText(item.name),
      pinyinInitials: toPinyinInitials(item.name),
      tagEntries,
    },
  };
}

export function filterItemsByTags(items: ItemWithTags[], selectedTagIds: number[]): ItemWithTags[] {
  if (selectedTagIds.length === 0) return items;
  return items.filter((item) =>
    selectedTagIds.every((tid) => item.tags.some((t) => t.id === tid)),
  );
}

export function buildSearchIndex(items: ItemWithTags[], mode: SearchMode): SearchIndex {
  return {
    entries: items.map(createSearchEntry),
    mode,
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
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== "or") {
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
    while (this.consume("not")) {
      const right = this.parseExclude();
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
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  return new Parser(tokens).parse();
}

function isEnglishTypoMatch(source: string, query: string): boolean {
  if (query.length < 3) return false;
  if (!/^[a-z0-9_.-]+$/.test(source) || !/^[a-z0-9_.-]+$/.test(query)) {
    return false;
  }

  const sourcePrefix = source.slice(0, Math.max(query.length, 1));
  if (Math.abs(sourcePrefix.length - query.length) > 1) return false;

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

function prefixMatches(value: string, query: string): boolean {
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  if (normalizedValue.startsWith(normalizedQuery)) return true;
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

  return !strict && prefixMatches(entry.item.path, query);
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

  return index.entries
    .filter((entry) => evaluateExpr(entry, expr, index.mode))
    .map((entry) => entry.item);
}

export function fuzzySearch(
  items: ItemWithTags[],
  query: string,
  mode: SearchMode,
  selectedTagIds: number[],
): ItemWithTags[] {
  const filtered = filterItemsByTags(items, selectedTagIds);
  const index = buildSearchIndex(filtered, mode);
  return searchWithIndex(index, query);
}

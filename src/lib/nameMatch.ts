// ============================================================================
// lib/nameMatch.ts — 列表过滤与搜索框提示用的轻量文本判断（不是对象搜索）
// ============================================================================
// 对象搜索（主窗 / 快速窗 / 命令面板）全部在后端 src-tauri/src/search；
// 这里只剩：侧栏「过滤标签…」等短列表的名称匹配，以及搜索框教学芯片的查询分类。
// ============================================================================

import { pinyinSync as pinyin } from "./pinyinProvider";

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 名称轻量匹配（侧栏“过滤标签…”等列表过滤）：子串命中，或拉丁查询命中全拼/首字母前缀。
 * pinyin-pro 未就绪时 pinyinReady=false，只做子串。
 */
export function matchesNameQuery(name: string, query: string, pinyinReady = true): boolean {
  const q = normalize(query);
  if (!q) return true;
  const lower = name.toLowerCase();
  if (lower.includes(q)) return true;
  if (!pinyinReady || !/^[a-z]+$/.test(q) || !CJK_RE.test(name)) return false;
  const initials = pinyin(lower, { pattern: "first", toneType: "none", type: "array" }).join("");
  const full = pinyin(lower, { toneType: "none", type: "array" }).join("");
  return initials.toLowerCase().startsWith(q) || full.toLowerCase().startsWith(q);
}

/** 搜索框教学芯片：表达式语法、纯拉丁拼音/缩写、普通关键词。 */
export type SearchQueryKind = "plain" | "pinyin" | "expression";

export function classifySearchQuery(query: string): SearchQueryKind {
  const trimmed = query.trim();
  if (!trimmed) return "plain";
  if (/&&|\|\||!!/.test(trimmed) || /[()]/.test(trimmed)) return "expression";
  if (/^[a-z]{2,}$/i.test(trimmed)) return "pinyin";
  return "plain";
}

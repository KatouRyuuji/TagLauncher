import { pinyinSync as pinyin } from "./pinyinProvider";

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/** 汉字判定（与 search.ts 的 CJK 口径一致；拼音取音只覆盖汉字） */
const HAN_CHAR_RE = /[㐀-䶿一-鿿豈-﫿]/;
/** 连续汉字段切分（/g/：exec 循环内提前 return 会残留 lastIndex，用前必须归零） */
const HAN_RUN_RE = /[㐀-䶿一-鿿豈-﫿]+/g;

/**
 * 从查询表达式提取全部字面词项：按 &&/||/!!/空白/括号 拆分，剥离 @ 严格前缀，
 * 小写归一并去重（!! 排除项的字面词同样参与高亮）。长词在前，同起点重叠时保留更长命中。
 */
function extractHighlightTerms(query: string): string[] {
  const terms: string[] = [];
  for (const raw of query.split(/&&|\|\||!!|[()\s]+/)) {
    const term = raw.replace(/^@+/, "").toLowerCase();
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms.sort((a, b) => b.length - a.length);
}

/**
 * 拼音高亮：term 为纯字母时，在文本的连续汉字段上按段首尝试两种命中——
 * 首字母缩写（段首字母串以 term 为前缀 → 高亮前 term.length 个汉字）；
 * 整词拼音前缀（段全拼逐字累加以 term 为前缀 → 高亮覆盖该前缀的汉字区间）。
 * 与 search.ts 的前缀匹配口径一致。
 * 拼音转换按汉字段 LRU 缓存：同一批名称/标签在逐击键高亮中不再重复跑 pinyin-pro。
 */
const PINYIN_CACHE_MAX = 1024;
const pinyinFirstCache = new Map<string, string>();
const pinyinFullCache = new Map<string, string[]>();

function cachedPinyinFirst(chars: string): string {
  const cached = pinyinFirstCache.get(chars);
  if (cached !== undefined) return cached;
  const value = pinyin(chars, { pattern: "first", toneType: "none", type: "array" }).join("");
  if (pinyinFirstCache.size >= PINYIN_CACHE_MAX) pinyinFirstCache.clear();
  pinyinFirstCache.set(chars, value);
  return value;
}

function cachedPinyinFull(chars: string): string[] {
  const cached = pinyinFullCache.get(chars);
  if (cached !== undefined) return cached;
  const value = pinyin(chars, { toneType: "none", type: "array" });
  if (pinyinFullCache.size >= PINYIN_CACHE_MAX) pinyinFullCache.clear();
  pinyinFullCache.set(chars, value);
  return value;
}

function pinyinHighlightRange(text: string, term: string): [number, number] | null {
  HAN_RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HAN_RUN_RE.exec(text)) !== null) {
    const start = match.index;
    const chars = match[0];

    if (term.length <= chars.length) {
      if (cachedPinyinFirst(chars).startsWith(term)) return [start, start + term.length];
    }

    const full = cachedPinyinFull(chars);
    let cumulative = "";
    for (let k = 0; k < full.length; k += 1) {
      cumulative += full[k];
      if (cumulative.length >= term.length) {
        if (cumulative.startsWith(term)) return [start, start + k + 1];
        break;
      }
      // 累加串已偏离 term 前缀，本段不可能命中
      if (!term.startsWith(cumulative)) break;
    }
  }
  return null;
}

/** splitHighlightSegments 结果缓存：键 = query + 文本，逐击键跨卡片复用 */
const SEGMENT_CACHE_MAX = 512;
const segmentCache = new Map<string, HighlightSegment[]>();

/**
 * 将文本按查询词拆分为高亮片段。所有字面词项参与子串匹配（大小写不敏感）；
 * 纯字母词项在含汉字的文本上额外尝试拼音/首字母高亮。空查询返回整段非高亮。
 */
export function splitHighlightSegments(text: string, query: string): HighlightSegment[] {
  if (!text) return [{ text: "", highlighted: false }];
  const cacheKey = `${query}${text}`;
  const cached = segmentCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const segments = computeHighlightSegments(text, query);
  if (segmentCache.size >= SEGMENT_CACHE_MAX) {
    // 简单失效：清掉最早一半（Map 迭代序即插入序）
    let drop = SEGMENT_CACHE_MAX / 2;
    for (const key of segmentCache.keys()) {
      segmentCache.delete(key);
      if ((drop -= 1) <= 0) break;
    }
  }
  segmentCache.set(cacheKey, segments);
  return segments;
}

function computeHighlightSegments(text: string, query: string): HighlightSegment[] {
  if (!text) return [{ text: "", highlighted: false }];
  const terms = extractHighlightTerms(query);
  if (terms.length === 0) return [{ text, highlighted: false }];

  // 收集候选命中区间：全部词项的子串匹配 + 纯字母词项的拼音/首字母命中
  const ranges: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  const textHasHan = HAN_CHAR_RE.test(text);
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(term, from);
      if (idx < 0) break;
      ranges.push([idx, idx + term.length]);
      from = idx + term.length;
    }
    if (textHasHan && /^[a-z]+$/.test(term)) {
      const range = pinyinHighlightRange(text, term);
      if (range) ranges.push(range);
    }
  }
  if (ranges.length === 0) return [{ text, highlighted: false }];

  // 起点升序、同起点长者优先；跳过与已选区间交叉的候选，保证高亮区间互不重叠
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/** 从搜索串提取首个可高亮的简单词项（忽略布尔操作符与 @ 严格前缀）。 */
function primaryHighlightTerm(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  for (const raw of trimmed.split(/\s+/)) {
    const term = raw.replace(/^@+/, "").replace(/[()]/g, "");
    if (!term || /^(&&|\|\||!!)$/.test(term)) continue;
    return term.toLowerCase();
  }
  return "";
}

/**
 * 将文本按查询词拆分为高亮片段。仅做子串匹配（大小写不敏感），空查询返回整段非高亮。
 */
export function splitHighlightSegments(text: string, query: string): HighlightSegment[] {
  if (!text) return [{ text: "", highlighted: false }];
  const term = primaryHighlightTerm(query);
  if (!term) return [{ text, highlighted: false }];

  const lower = text.toLowerCase();
  const idx = lower.indexOf(term);
  if (idx < 0) return [{ text, highlighted: false }];

  const segments: HighlightSegment[] = [];
  if (idx > 0) segments.push({ text: text.slice(0, idx), highlighted: false });
  segments.push({ text: text.slice(idx, idx + term.length), highlighted: true });
  const rest = idx + term.length;
  if (rest < text.length) segments.push({ text: text.slice(rest), highlighted: false });
  return segments;
}

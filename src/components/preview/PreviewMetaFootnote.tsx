// ============================================================================
// components/preview/PreviewMetaFootnote.tsx — 图/视频脚注（尺寸 · 大小 · 时间）
// ============================================================================

export function PreviewMetaFootnote({ parts }: { parts: Array<string | null | undefined> }) {
  const shown = parts.filter((part): part is string => Boolean(part && part.trim()));
  if (shown.length === 0) return null;
  return <p className="preview-meta-footnote">{shown.join(" · ")}</p>;
}

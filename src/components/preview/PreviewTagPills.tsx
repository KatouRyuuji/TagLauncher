// ============================================================================
// components/preview/PreviewTagPills.tsx — 预览内标签胶囊（点选即筛选并关窗）
// ============================================================================

import type { CSSProperties } from "react";
import type { Tag } from "../../types";

export function PreviewTagPills({
  tags,
  onTagSelect,
}: {
  tags: Tag[];
  onTagSelect: (tagId: number) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          title={`按「${tag.name}」筛选`}
          onClick={() => onTagSelect(tag.id)}
          className="tag-pill px-2 py-0.5 text-[13px]"
          style={{ "--tag-color": tag.color } as CSSProperties}
        >
          {tag.name}
        </button>
      ))}
    </div>
  );
}

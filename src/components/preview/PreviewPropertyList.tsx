// ============================================================================
// components/preview/PreviewPropertyList.tsx — 音频/其它类型的属性卡
// ============================================================================
// 音频时长不在这里出现（只活在播放条）。字段：大小 / 修改 / 最近 / 标签。
// ============================================================================

import type { ObjectPreviewFileInfo } from "../../lib/db";
import { formatBytes, formatTimestamp } from "../../lib/itemQuery";
import type { ItemWithTags } from "../../types";
import { formatLocalDateTime } from "./previewFormat";
import { PreviewTagPills } from "./PreviewTagPills";

export function PreviewPropertyList({
  item,
  info,
  onTagSelect,
}: {
  item: ItemWithTags;
  info: ObjectPreviewFileInfo | null;
  onTagSelect: (tagId: number) => void;
}) {
  return (
    <dl className="workbench-panel grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-sm">
      <dt className="text-[var(--text-faint)]">大小</dt>
      <dd className="text-[var(--text-secondary)]">{info?.size != null ? formatBytes(info.size) : "未知"}</dd>
      <dt className="text-[var(--text-faint)]">修改时间</dt>
      <dd className="text-[var(--text-secondary)]">
        {info?.modified_at_secs ? formatLocalDateTime(info.modified_at_secs) : "未知"}
      </dd>
      <dt className="text-[var(--text-faint)]">最近使用</dt>
      <dd className="text-[var(--text-secondary)]">{formatTimestamp(item.last_used_at)}</dd>
      {item.tags.length > 0 && (
        <>
          <dt className="text-[var(--text-faint)]">标签</dt>
          <dd>
            <PreviewTagPills tags={item.tags} onTagSelect={onTagSelect} />
          </dd>
        </>
      )}
    </dl>
  );
}

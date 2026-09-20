// ============================================================================
// components/preview/ImagePreviewBody.tsx — 图：大图 bleed + 脚注元数据
// ============================================================================

import { useState } from "react";
import { FileImage } from "lucide-react";
import { formatBytes } from "../../lib/itemQuery";
import type { ObjectPreviewFileInfo } from "../../lib/db";
import type { ItemWithTags } from "../../types";
import { PreviewMetaFootnote } from "./PreviewMetaFootnote";
import { PreviewTagPills } from "./PreviewTagPills";
import { formatLocalDateTime, formatPixelSize, toAssetUrl } from "./previewFormat";

export function ImagePreviewBody({
  item,
  info,
  onTagSelect,
}: {
  item: ItemWithTags;
  info: ObjectPreviewFileInfo | null;
  onTagSelect: (tagId: number) => void;
}) {
  const src = toAssetUrl(item.path);
  const [failed, setFailed] = useState(!src);
  const [pixelSize, setPixelSize] = useState<string | null>(null);

  return (
    <div>
      <div className="preview-image-stage">
        {failed || !src ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-sm text-[color-mix(in_srgb,var(--bg-elevated)_82%,transparent)]">
            <FileImage aria-hidden="true" size={28} strokeWidth={1.6} />
            <p>无法预览图片</p>
          </div>
        ) : (
          <>
            {/* 同图模糊延展填充两侧，主图 contain 叠在上层 */}
            <img src={src} alt="" aria-hidden="true" className="preview-image-backdrop" />
            <img
              src={src}
              alt={item.name}
              decoding="async"
              onError={() => setFailed(true)}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                const label = formatPixelSize(naturalWidth, naturalHeight);
                setPixelSize(label || null);
              }}
            />
          </>
        )}
      </div>
      <div className="preview-body-pad space-y-2">
        <PreviewMetaFootnote
          parts={[
            pixelSize,
            info?.size != null ? formatBytes(info.size) : null,
            info?.modified_at_secs ? formatLocalDateTime(info.modified_at_secs) : null,
          ]}
        />
        <PreviewTagPills tags={item.tags} onTagSelect={onTagSelect} />
      </div>
    </div>
  );
}

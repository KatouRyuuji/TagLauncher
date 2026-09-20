// ============================================================================
// components/preview/VideoPreviewBody.tsx — 影：16:9 播放框是主体
// ============================================================================
// 有片源用 <video controls>；失败时用中性灰底 + 格式图标写明原因（不用彩色
// 首帧海报——画面感会误导「已加载」），打开动作统一收到底栏主按钮。
// ============================================================================

import { useState } from "react";
import { VideoOff } from "lucide-react";
import { formatBytes } from "../../lib/itemQuery";
import type { ObjectPreviewFileInfo } from "../../lib/db";
import type { ItemWithTags } from "../../types";
import { PreviewMetaFootnote } from "./PreviewMetaFootnote";
import { PreviewTagPills } from "./PreviewTagPills";
import { formatClock, formatLocalDateTime, formatPixelSize, toAssetUrl } from "./previewFormat";

export function VideoPreviewBody({
  item,
  info,
  posterUrl,
  onTagSelect,
}: {
  item: ItemWithTags;
  info: ObjectPreviewFileInfo | null;
  posterUrl: string | null;
  onTagSelect: (tagId: number) => void;
}) {
  const src = toAssetUrl(item.path);
  const [failed, setFailed] = useState(!src);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);

  return (
    <div>
      <div className="preview-video-stage">
        {src && (
          <video
            controls
            preload="metadata"
            src={src}
            poster={posterUrl ?? undefined}
            className={failed || !ready ? "hidden" : "h-full w-full object-contain"}
            onLoadedMetadata={(event) => {
              const el = event.currentTarget;
              if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
              const label = formatPixelSize(el.videoWidth, el.videoHeight);
              if (label) setResolution(label);
              setReady(true);
            }}
            onError={() => setFailed(true)}
          />
        )}
        {failed && <VideoFailChrome />}
      </div>
      <div className="preview-body-pad space-y-2">
        <PreviewMetaFootnote
          parts={[
            duration != null ? formatClock(duration) : null,
            resolution,
            info?.size != null ? formatBytes(info.size) : null,
            info?.modified_at_secs ? formatLocalDateTime(info.modified_at_secs) : null,
          ]}
        />
        <PreviewTagPills tags={item.tags} onTagSelect={onTagSelect} />
      </div>
    </div>
  );
}

function VideoFailChrome() {
  return (
    <div className="preview-video-fail items-center justify-center gap-3 px-6 text-center">
      <VideoOff
        size={40}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-[color-mix(in_srgb,var(--bg-elevated)_55%,transparent)]"
      />
      <p className="preview-video-fail-hint text-sm">
        无法在应用内预览该格式，可用底栏「打开」调用外部播放器
      </p>
    </div>
  );
}

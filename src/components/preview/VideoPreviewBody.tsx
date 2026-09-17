// ============================================================================
// components/preview/VideoPreviewBody.tsx — 影：16:9 播放框是主体
// ============================================================================
// 有片源用 <video controls>；失败仍是播放器皮（禁用大播放钮 + 时间轴 + 首帧），
// 禁止退回一张无铬静帧。
// ============================================================================

import { useState, type CSSProperties } from "react";
import { Play } from "lucide-react";
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
        {failed && <VideoFailChrome name={item.name} posterUrl={posterUrl} />}
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

function VideoFailChrome({ name, posterUrl }: { name: string; posterUrl: string | null }) {
  return (
    <div className="preview-video-fail">
      {posterUrl ? (
        <img src={posterUrl} alt={`${name} 首帧`} className="preview-video-fail-poster" />
      ) : null}
      <div className="preview-video-fail-center">
        <button
          type="button"
          className="preview-play-orb"
          disabled
          aria-label="无法播放"
          title="无法在应用内预览"
        >
          <Play aria-hidden="true" size={28} strokeWidth={1.6} fill="currentColor" />
        </button>
      </div>
      <div className="preview-video-chrome">
        <div className="flex items-center gap-2">
          <input
            type="range"
            className="preview-range"
            min={0}
            max={1}
            value={0}
            disabled
            aria-label="播放进度"
            style={{ "--range-progress": "0%" } as CSSProperties}
          />
          <span className="preview-timecode preview-timecode-on-media">0:00 / --:--</span>
        </div>
        <p className="preview-video-fail-hint">无法在应用内预览，可用外部播放器打开</p>
      </div>
    </div>
  );
}

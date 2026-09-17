// ============================================================================
// components/preview/AudioPreviewBody.tsx — 声：条形封面 + 自绘播放条
// ============================================================================
// 时长只在播放条出现一次。总长优先 <audio>.duration，不可用则回退 duration_ms。
// ============================================================================

import { useRef, useState, type CSSProperties } from "react";
import { Music, Pause, Play } from "lucide-react";
import type { AudioPreviewInfo, ObjectPreviewFileInfo } from "../../lib/db";
import type { ItemWithTags } from "../../types";
import { PreviewPropertyList } from "./PreviewPropertyList";
import { formatClock, resolveMediaDurationSeconds, toAssetUrl } from "./previewFormat";

export function AudioPreviewBody({
  item,
  info,
  audio,
  coverFallbackUrl,
  onTagSelect,
}: {
  item: ItemWithTags;
  info: ObjectPreviewFileInfo | null;
  audio: AudioPreviewInfo | null;
  coverFallbackUrl: string | null;
  onTagSelect: (tagId: number) => void;
}) {
  const src = toAssetUrl(item.path);
  const coverSrc = audio?.album_cover_data_url || coverFallbackUrl;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [coverFailed, setCoverFailed] = useState(!coverSrc);
  const [failed, setFailed] = useState(!src);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [elementDuration, setElementDuration] = useState<number | null>(null);

  const total = resolveMediaDurationSeconds(elementDuration, audio?.duration_ms);
  const percent = total && total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const artistAlbum = [audio?.artist, audio?.album].filter(Boolean).join(" · ");

  const syncDuration = (el: HTMLAudioElement) => {
    setElementDuration(Number.isFinite(el.duration) ? el.duration : null);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el || failed) return;
    if (el.paused) {
      void el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  };

  const seek = (next: number) => {
    setCurrent(next);
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    if (total != null && total > el.duration + 1) {
      el.currentTime = (next / total) * el.duration;
      return;
    }
    el.currentTime = next;
  };

  return (
    <div className="space-y-4">
      <div className="preview-audio-strip">
        <div className="preview-audio-main">
          {coverSrc && !coverFailed ? (
            <img
              src={coverSrc}
              alt=""
              className="preview-audio-cover"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="preview-audio-cover preview-audio-cover-fallback" aria-hidden="true">
              <Music size={28} strokeWidth={1.6} />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--text-primary)]">{audio?.title || item.name}</p>
            <p className="mt-1 truncate text-[13px] text-[var(--text-muted)]">{artistAlbum || "音频对象"}</p>
          </div>
        </div>

        <div className="preview-audio-transport">
          <button
            type="button"
            className="preview-play-orb preview-play-orb-sm"
            disabled={failed}
            aria-label={playing ? "暂停" : "播放"}
            title={failed ? "无法播放" : playing ? "暂停" : "播放"}
            onClick={togglePlay}
          >
            {playing ? (
              <Pause aria-hidden="true" size={16} strokeWidth={1.8} fill="currentColor" />
            ) : (
              <Play aria-hidden="true" size={16} strokeWidth={1.8} fill="currentColor" />
            )}
          </button>
          <input
            type="range"
            className="preview-range"
            min={0}
            max={total ?? 0}
            step={0.1}
            value={Number.isFinite(current) ? current : 0}
            disabled={failed || total == null}
            aria-label="播放进度"
            style={{ "--range-progress": `${percent}%` } as CSSProperties}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="preview-timecode">
            {formatClock(current)} / {formatClock(total, "--:--")}
          </span>
        </div>

        {failed && (
          <p className="text-[12px] text-[var(--text-muted)]">无法播放，可用外部播放器打开</p>
        )}

        {src && (
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            className="hidden"
            onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
            onDurationChange={(event) => syncDuration(event.currentTarget)}
            onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setCurrent(0);
            }}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          />
        )}
      </div>

      <PreviewPropertyList item={item} info={info} onTagSelect={onTagSelect} />
    </div>
  );
}

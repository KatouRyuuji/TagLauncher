// ============================================================================
// components/preview/previewFormat.ts — 快速预览共用格式化
// ============================================================================
// 时码、资源 URL、本地时间。音频总长优先用 <audio>.duration；NaN / 0 / 极短
// 占位（demo 静音 WAV ≈0.3s）视为不可用，回退 audio.duration_ms，避免巡演里
// 出现 0:00 / 0:00。
// ============================================================================

import { convertFileSrc } from "@tauri-apps/api/core";

/** 磁盘路径 → WebView 可访问 URL；空路径返回 null。 */
export function toAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return convertFileSrc(path.replace(/\\/g, "/"));
}

/** 秒 → m:ss。不可用时返回 empty（默认 0:00）。 */
export function formatClock(seconds: number | null | undefined, empty = "0:00"): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return empty;
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** 音频总时长（元数据 duration_ms）→ m:ss。 */
export function formatDurationMs(ms: number): string {
  return formatClock(ms / 1000);
}

/**
 * 媒体总长（秒）：元素 duration 可用则用它；否则回退 duration_ms。
 * 元素 duration ≤ 1s 视为占位/未就绪（demo 静音 WAV），不抢元数据。
 */
export function resolveMediaDurationSeconds(
  elementSeconds: number | null | undefined,
  durationMs: number | null | undefined,
): number | null {
  const elementUsable = elementSeconds != null && Number.isFinite(elementSeconds) && elementSeconds > 1;
  if (elementUsable) return elementSeconds;
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs / 1000;
  }
  if (elementSeconds != null && Number.isFinite(elementSeconds) && elementSeconds > 0) {
    return elementSeconds;
  }
  return null;
}

export function formatLocalDateTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "未知";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 仅日期，给文件夹摘要行用（例：2025-08-24）。 */
export function formatLocalDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "未知";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatPixelSize(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "";
  return `${width} × ${height}`;
}

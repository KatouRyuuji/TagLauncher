import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Copy, File, Folder, Play, ScanSearch, TriangleAlert, X } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { copyText } from "../lib/clipboard";
import * as db from "../lib/db";
import { formatBytes, formatTimestamp } from "../lib/itemQuery";
import { getTypeLabel } from "../lib/itemUtils";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";

interface QuickPreviewProps {
  items: ItemWithTags[];
  onLaunch: (id: number) => void;
}

export function QuickPreview({ items, onLaunch }: QuickPreviewProps) {
  const previewItemId = useAppStore((state) => state.previewItemId);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const item = previewItemId == null ? null : items.find((entry) => entry.id === previewItemId) ?? null;
  const trapRef = useFocusTrap<HTMLDivElement>({ active: item !== null });

  useEscapeKey(() => setPreviewItemId(null), item !== null);

  useEffect(() => {
    if (previewItemId == null) return;
    if (!items.some((entry) => entry.id === previewItemId)) {
      setPreviewItemId(null);
    }
  }, [items, previewItemId, setPreviewItemId]);

  if (!item) return null;

  return createPortal(
    <div
      data-quick-preview=""
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_72%,transparent)] px-3 py-4 sm:px-6 sm:py-8"
      style={{ zIndex: "var(--z-quick-preview)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPreviewItemId(null);
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="快速预览"
        className="modal-surface flex max-h-[88vh] w-full max-w-[920px] flex-col overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-[68px] items-start justify-between gap-3 border-b border-[var(--line-hairline)] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <ScanSearch aria-hidden="true" size={18} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="instrument-label">Preview / {getTypeLabel(item.type)}</p>
              <h2 className="mt-1 truncate text-base font-semibold text-[var(--text-primary)]" title={item.name}>
                {item.name}
              </h2>
              <p className="data-readout mt-1 truncate text-[10px] text-[var(--text-faint)]" title={item.path}>
                {item.path}
              </p>
            </div>
          </div>
          <button type="button" className="icon-button shrink-0" title="关闭" aria-label="关闭预览" onClick={() => setPreviewItemId(null)}>
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-[var(--surface-recessed)] px-4 py-4 sm:px-5">
          {item.is_missing ? (
            <div role="alert" className="flex items-start gap-3 border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--color-warning)]">
              <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} className="mt-0.5 shrink-0" />
              <p>对象已失效，无法预览当前文件。归类仍保留，文件恢复后会自动关联。</p>
            </div>
          ) : (
            <PreviewBody
              item={item}
              onTagSelect={(tagId) => {
                setSelectedTagIds([tagId]);
                setPreviewItemId(null);
              }}
            />
          )}
        </div>

        <footer className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-2.5 sm:px-5">
          <p className="flex items-center gap-2 text-[11px] text-[var(--text-faint)]"><span className="status-led" aria-hidden="true" />本地对象预览</p>
          <div className="flex items-center gap-2">
            <button type="button" className="action-button" onClick={() => void copyText(item.path, "已复制路径")}>
              <Copy aria-hidden="true" size={15} strokeWidth={1.8} />
              复制路径
            </button>
            <button
              type="button"
              className="action-button action-button-primary"
              onClick={() => {
                setPreviewItemId(null);
                void onLaunch(item.id);
              }}
            >
              <Play aria-hidden="true" size={15} strokeWidth={1.9} />
              启动
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function PreviewBody({ item, onTagSelect }: { item: ItemWithTags; onTagSelect: (tagId: number) => void }) {
  const [info, setInfo] = useState<db.ObjectPreviewFileInfo | null>(null);
  const [entries, setEntries] = useState<db.ObjectDirectoryEntry[]>([]);
  const [audio, setAudio] = useState<db.AudioPreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setImageFailed(false);
    setCoverFailed(false);
    setInfo(null);
    setEntries([]);
    setAudio(null);
    setLoading(true);

    void (async () => {
      try {
        const fileInfo = await db.getObjectFileInfo(item.path);
        if (cancelled) return;
        setInfo(fileInfo);
        if (item.type === "folder") {
          const listed = await db.listObjectDirectory(item.path);
          if (!cancelled) setEntries(listed.slice(0, 48));
        } else if (item.type === "audio") {
          const preview = await db.getAudioPreview(item.path);
          if (!cancelled) setAudio(preview);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.id, item.path, item.type]);

  // 封面图源：图片对象回退到文件本身；音频不回退——把音频文件当 <img> src 必然 onError，
  // 白发一次无效资源请求。音频封面只取系统缩略图（icon_path）或内嵌专辑封面。
  const assetUrl = toAssetUrl(item.icon_path || (item.type === "image" ? item.path : null));

  if (loading && !error) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="加载预览">
        <div className="skeleton-block h-40 rounded-[var(--radius-md)]" />
        <div className="space-y-2">
          <div className="skeleton-block h-3 w-24 rounded" />
          <div className="skeleton-block h-3 w-full rounded" />
          <div className="skeleton-block h-3 w-2/3 rounded" />
        </div>
      </div>
    );
  }

  return (
      <div className="space-y-4">
      {item.type === "image" && (
        <div className="workbench-panel flex max-h-[52vh] min-h-[180px] items-center justify-center overflow-hidden bg-[var(--bg-base)]">
          {imageFailed ? (
            <p className="px-4 py-8 text-sm text-[var(--text-muted)]">无法加载图片预览</p>
          ) : (
            <img
              src={toAssetUrl(item.path) ?? undefined}
              alt={item.name}
              decoding="async"
              className="max-h-[52vh] max-w-full object-contain"
              onError={() => setImageFailed(true)}
            />
          )}
        </div>
      )}

      {item.type === "audio" && (
        <div className="space-y-3">
          {audio?.album_cover_data_url || assetUrl ? (
            coverFailed ? null : (
            <img
              src={audio?.album_cover_data_url ?? assetUrl ?? undefined}
              alt=""
              className="mx-auto h-44 w-44 rounded-[var(--radius-md)] border border-[var(--line-hairline)] object-cover shadow-[var(--shadow-md)]"
              onError={() => setCoverFailed(true)}
            />
            )
          ) : null}
          <div className="text-center text-sm text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">{audio?.title || item.name}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {[audio?.artist, audio?.album].filter(Boolean).join(" · ") || "音频对象"}
            </p>
          </div>
          <audio
            controls
            preload="metadata"
            src={toAssetUrl(item.path) ?? undefined}
            className="w-full"
            onError={() => setError("无法加载音频预览")}
          />
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <dl className="workbench-panel grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-sm">
        <dt className="text-[var(--text-faint)]">大小</dt>
        <dd className="text-[var(--text-secondary)]">{formatBytes(info?.size)}</dd>
        <dt className="text-[var(--text-faint)]">修改时间</dt>
        <dd className="text-[var(--text-secondary)]">
          {info?.modified_at_secs ? formatLocalDateTime(info.modified_at_secs) : "未知"}
        </dd>
        <dt className="text-[var(--text-faint)]">最近使用</dt>
        <dd className="text-[var(--text-secondary)]">{formatTimestamp(item.last_used_at)}</dd>
        {item.tags.length > 0 && (
          <>
            <dt className="text-[var(--text-faint)]">标签</dt>
            <dd className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  title={`按「${tag.name}」筛选`}
                  onClick={() => onTagSelect(tag.id)}
                  className="rounded-[var(--radius-full)] px-2 py-0.5 text-[11px] transition-opacity hover:opacity-80"
                  style={{ backgroundColor: `color-mix(in srgb, ${tag.color} 18%, transparent)`, color: tag.color }}
                >
                  {tag.name}
                </button>
              ))}
            </dd>
          </>
        )}
      </dl>

      {item.type === "folder" && (
        <div>
          <p className="mb-2 text-xs font-medium text-[var(--text-faint)]">目录内容（最多 48 项）</p>
          {entries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">空文件夹或无法列出</p>
          ) : (
            <ul className="workbench-panel divide-y divide-[var(--line-hairline)] overflow-hidden text-sm text-[var(--text-secondary)]">
              {entries.map((entry) => (
                <li key={entry.path} className="flex min-h-9 items-center gap-2 px-3 py-2">
                  {entry.is_dir ? (
                    <Folder aria-hidden="true" size={15} strokeWidth={1.8} className="shrink-0 text-[var(--color-warning)]" />
                  ) : (
                    <File aria-hidden="true" size={15} strokeWidth={1.8} className="shrink-0 text-[var(--text-faint)]" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function toAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return convertFileSrc(path.replace(/\\/g, "/"));
}

function formatLocalDateTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "未知";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

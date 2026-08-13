import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEscapeKey } from "../hooks/useEscapeKey";
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
  const item = previewItemId == null ? null : items.find((entry) => entry.id === previewItemId) ?? null;

  useEscapeKey(() => setPreviewItemId(null), item !== null);

  if (!item) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_72%,transparent)] px-6 py-8"
      style={{ zIndex: "var(--z-quick-preview)" as unknown as number }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPreviewItemId(null);
      }}
    >
      <div
        className="modal-surface flex max-h-[86vh] w-full max-w-[760px] flex-col overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[var(--accent-primary)]">{getTypeLabel(item.type)}</p>
            <h3 className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]" title={item.name}>
              {item.name}
            </h3>
            <p className="mt-1 break-all text-xs text-[var(--text-muted)]" title={item.path}>
              {item.path}
            </p>
          </div>
          <button type="button" className="icon-button" title="关闭" onClick={() => setPreviewItemId(null)}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {item.is_missing ? (
            <p className="text-sm text-[var(--color-warning)]">对象已失效，无法预览当前文件。归类仍保留，文件恢复后会自动关联。</p>
          ) : (
            <PreviewBody item={item} />
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <p className="text-[11px] text-[var(--text-faint)]">空格 / Esc 关闭 · ← → 切换</p>
          <div className="flex items-center gap-2">
            <button type="button" className="action-button" onClick={() => void copyText(item.path, "已复制路径")}>
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
              启动
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function PreviewBody({ item }: { item: ItemWithTags }) {
  const [info, setInfo] = useState<db.ObjectPreviewFileInfo | null>(null);
  const [entries, setEntries] = useState<db.ObjectDirectoryEntry[]>([]);
  const [audio, setAudio] = useState<db.AudioPreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setInfo(null);
    setEntries([]);
    setAudio(null);

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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.id, item.path, item.type]);

  const assetUrl = toAssetUrl(item.icon_path || (item.type === "image" || item.type === "audio" ? item.path : null));

  return (
    <div className="space-y-4">
      {item.type === "image" && (
        <div className="flex max-h-[48vh] items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-hover)]">
          <img
            src={toAssetUrl(item.path) ?? undefined}
            alt={item.name}
            className="max-h-[48vh] max-w-full object-contain"
          />
        </div>
      )}

      {item.type === "audio" && (
        <div className="space-y-3">
          {audio?.album_cover_data_url || assetUrl ? (
            <img
              src={audio?.album_cover_data_url ?? assetUrl ?? undefined}
              alt=""
              className="mx-auto h-40 w-40 rounded-[var(--radius-md)] object-cover"
            />
          ) : null}
          <div className="text-center text-sm text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">{audio?.title || item.name}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {[audio?.artist, audio?.album].filter(Boolean).join(" · ") || "音频对象"}
            </p>
          </div>
          <audio controls src={toAssetUrl(item.path) ?? undefined} className="w-full" />
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-[var(--text-faint)]">大小</dt>
        <dd className="text-[var(--text-secondary)]">{formatBytes(info?.size)}</dd>
        <dt className="text-[var(--text-faint)]">修改时间</dt>
        <dd className="text-[var(--text-secondary)]">
          {info?.modified_at_secs ? formatTimestamp(new Date(info.modified_at_secs * 1000).toISOString()) : "未知"}
        </dd>
        <dt className="text-[var(--text-faint)]">最近使用</dt>
        <dd className="text-[var(--text-secondary)]">{formatTimestamp(item.last_used_at)}</dd>
        {item.tags.length > 0 && (
          <>
            <dt className="text-[var(--text-faint)]">标签</dt>
            <dd className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-[var(--radius-full)] px-2 py-0.5 text-[11px]"
                  style={{ backgroundColor: `color-mix(in srgb, ${tag.color} 18%, transparent)`, color: tag.color }}
                >
                  {tag.name}
                </span>
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
            <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
              {entries.map((entry) => (
                <li key={entry.path} className="truncate">
                  {entry.is_dir ? "📁" : "📄"} {entry.name}
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

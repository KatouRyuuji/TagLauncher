import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, FolderOpen, Play, ScanSearch, TriangleAlert, X } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useItemVisual } from "../hooks/useItemVisual";
import { copyText } from "../lib/clipboard";
import * as db from "../lib/db";
import { cardOpenLabel, openMenuLabel } from "../lib/itemActionCopy";
import { getTypeLabel } from "../lib/itemUtils";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import { AudioPreviewBody } from "./preview/AudioPreviewBody";
import { FolderPreviewBody } from "./preview/FolderPreviewBody";
import { ImagePreviewBody } from "./preview/ImagePreviewBody";
import { PreviewPropertyList } from "./preview/PreviewPropertyList";
import { VideoPreviewBody } from "./preview/VideoPreviewBody";
import { toAssetUrl } from "./preview/previewFormat";

interface QuickPreviewProps {
  items: ItemWithTags[];
  onLaunch: (id: number) => void;
  onAddItems?: (paths: string[]) => Promise<void>;
}

export function QuickPreview({ items, onLaunch, onAddItems }: QuickPreviewProps) {
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

  const isFolder = item.type === "folder";

  return createPortal(
    <div
      data-quick-preview=""
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center px-3 py-4 sm:px-6 sm:py-8"
      style={{ zIndex: "var(--z-quick-preview)", backgroundColor: "var(--overlay-bg)" }}
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
              <p className="instrument-label">{getTypeLabel(item.type)}</p>
              <h2 className="mt-1 truncate text-base font-semibold text-[var(--text-primary)]" title={item.name}>
                {item.name}
              </h2>
              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                <p className="data-readout min-w-0 flex-1 truncate text-[13px] text-[var(--text-faint)]" title={item.path}>
                  {item.path}
                </p>
                {isFolder && (
                  <button
                    type="button"
                    className="icon-button shrink-0"
                    title="复制路径"
                    aria-label="复制路径"
                    onClick={() => void copyText(item.path, "已复制路径")}
                  >
                    <Copy aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <button type="button" className="icon-button shrink-0" title="关闭" aria-label="关闭预览" onClick={() => setPreviewItemId(null)}>
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className={previewContentClassName(item)}>
          {item.is_missing ? (
            <div role="alert" className="flex items-start gap-3 border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[var(--status-warning-bg)] p-4 text-sm text-[var(--color-warning-ink)]">
              <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} className="mt-0.5 shrink-0" />
              <div>
                <p>项目已失效，无法预览当前文件。归类仍保留，文件恢复后会自动关联。</p>
                <button
                  type="button"
                  className="action-button mt-3"
                  onClick={() => {
                    setPreviewItemId(null);
                    useAppStore.getState().setMissingReviewOpen(true);
                  }}
                >
                  查看失效项目
                </button>
              </div>
            </div>
          ) : (
            <PreviewBody
              item={item}
              onAddItems={onAddItems}
              onTagSelect={(tagId) => {
                setSelectedTagIds([tagId]);
                setPreviewItemId(null);
              }}
            />
          )}
        </div>

        <footer className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-2.5 sm:px-5">
          <p className="flex items-center gap-2 text-[13px] text-[var(--text-faint)]"><span className="status-led" aria-hidden="true" />本地预览</p>
          <div className="flex items-center gap-2">
            {!isFolder && (
              <button type="button" className="action-button" onClick={() => void copyText(item.path, "已复制路径")}>
                <Copy aria-hidden="true" size={15} strokeWidth={1.8} />
                复制路径
              </button>
            )}
            <button
              type="button"
              className="action-button action-button-primary"
              onClick={() => {
                setPreviewItemId(null);
                void onLaunch(item.id);
              }}
            >
              {isFolder ? (
                <FolderOpen aria-hidden="true" size={15} strokeWidth={1.9} />
              ) : (
                <Play aria-hidden="true" size={15} strokeWidth={1.9} />
              )}
              {isFolder ? openMenuLabel("folder") : cardOpenLabel(item.type)}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function previewContentClassName(item: ItemWithTags): string {
  const base = "min-h-0 flex-1 bg-[var(--surface-recessed)]";
  if (item.is_missing) return `${base} overflow-auto px-4 py-4 sm:px-5`;
  if (item.type === "folder") return `${base} flex flex-col overflow-hidden`;
  if (item.type === "image" || item.type === "video") return `${base} overflow-auto`;
  return `${base} overflow-auto px-4 py-4 sm:px-5`;
}

function PreviewBody({
  item,
  onTagSelect,
  onAddItems,
}: {
  item: ItemWithTags;
  onTagSelect: (tagId: number) => void;
  onAddItems?: (paths: string[]) => Promise<void>;
}) {
  const iconPath = useItemVisual(item);
  const [info, setInfo] = useState<db.ObjectPreviewFileInfo | null>(null);
  const [entries, setEntries] = useState<db.ObjectDirectoryEntry[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [audio, setAudio] = useState<db.AudioPreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setInfo(null);
    setEntries([]);
    setEntryTotal(0);
    setAudio(null);
    setLoading(true);

    void (async () => {
      try {
        const fileInfo = await db.getObjectFileInfo(item.path);
        if (cancelled) return;
        setInfo(fileInfo);
        if (item.type === "folder") {
          const listed = await db.listObjectDirectory(item.path);
          if (!cancelled) {
            setEntries(listed.slice(0, 48));
            setEntryTotal(listed.length);
          }
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

  const fill = item.type === "folder";

  if (loading && !error) {
    return <PreviewSkeleton type={item.type} />;
  }

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : "space-y-4"}>
      {error && <p className="px-4 text-sm text-[var(--color-danger-ink)]">{error}</p>}
      {item.type === "image" && (
        <ImagePreviewBody key={item.id} item={item} info={info} onTagSelect={onTagSelect} />
      )}
      {item.type === "audio" && (
        <AudioPreviewBody
          key={item.id}
          item={item}
          info={info}
          audio={audio}
          coverFallbackUrl={toAssetUrl(iconPath)}
          onTagSelect={onTagSelect}
        />
      )}
      {item.type === "video" && (
        <VideoPreviewBody
          key={item.id}
          item={item}
          info={info}
          posterUrl={toAssetUrl(iconPath)}
          onTagSelect={onTagSelect}
        />
      )}
      {item.type === "folder" && (
        <FolderPreviewBody
          key={item.id}
          item={item}
          info={info}
          entries={entries}
          entryTotal={entryTotal}
          onTagSelect={onTagSelect}
          onAddItems={onAddItems}
        />
      )}
      {item.type !== "image" && item.type !== "audio" && item.type !== "video" && item.type !== "folder" && (
        <PreviewPropertyList item={item} info={info} onTagSelect={onTagSelect} />
      )}
    </div>
  );
}

function PreviewSkeleton({ type }: { type: string }) {
  if (type === "image") {
    return <div className="preview-image-stage skeleton-block rounded-none" aria-busy="true" aria-label="加载预览" />;
  }
  if (type === "video") {
    return <div className="preview-video-stage skeleton-block rounded-none" aria-busy="true" aria-label="加载预览" />;
  }
  if (type === "folder") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3" aria-busy="true" aria-label="加载预览">
        <div className="skeleton-block h-4 w-48 rounded" />
        <div className="skeleton-block h-3 w-72 rounded" />
        <div className="skeleton-block min-h-0 flex-1 rounded-[var(--radius-md)]" />
      </div>
    );
  }
  return (
    <div className="space-y-4" aria-busy="true" aria-label="加载预览">
      <div className="skeleton-block h-24 rounded-[var(--radius-md)]" />
      <div className="space-y-2">
        <div className="skeleton-block h-3 w-24 rounded" />
        <div className="skeleton-block h-3 w-full rounded" />
        <div className="skeleton-block h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}

// ============================================================================
// components/preview/FolderPreviewBody.tsx — 夹：目录是主体
// ============================================================================
// 属性缩成顶上一行；面包屑显示当前所在的子目录，可在对象目录内逐层进入和返回。
// 行内操作悬停、聚焦或键盘高亮时浮出；列表获得焦点时 ↑↓/Home/End 移动高亮，
// Enter 进入文件夹或打开文件，Backspace / Alt+← 返回上一级。
// ============================================================================

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, File, FileSpreadsheet, FileText, Folder, Plus, Presentation } from "lucide-react";
import * as db from "../../lib/db";
import { showToast } from "../../lib/toast";
import type { ItemWithTags } from "../../types";
import { formatLocalDate } from "./previewFormat";
import { PreviewTagPills } from "./PreviewTagPills";

const ROW_HEIGHT = 36;
/** 与后端 list_object_directory 的单次返回上限一致 */
const MAX_ENTRIES = 5000;

/** Office 三件套按扩展名着色（蓝=文档 / 绿=表格 / 橙=演示，全走语义 token），其余文件保持中性灰 */
function entryIcon(entry: db.ObjectDirectoryEntry): { Icon: typeof File; className: string } {
  if (entry.is_dir) return { Icon: Folder, className: "shrink-0 text-[var(--color-warning-ink)]" };
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["doc", "docx"].includes(ext)) return { Icon: FileText, className: "shrink-0 text-[var(--color-info-ink)]" };
  if (["xls", "xlsx", "csv"].includes(ext)) return { Icon: FileSpreadsheet, className: "shrink-0 text-[var(--color-success-ink)]" };
  if (["ppt", "pptx"].includes(ext)) return { Icon: Presentation, className: "shrink-0 text-[var(--color-warning-ink)]" };
  return { Icon: File, className: "shrink-0 text-[var(--text-faint)]" };
}

/** 面包屑：第一段是对象根目录，其后是当前路径相对根目录的各级子目录 */
function breadcrumbs(rootPath: string, rootName: string, browsePath: string): { label: string; path: string }[] {
  const base = rootPath.replace(/[\\/]+$/, "");
  const sep = browsePath.charAt(base.length) || "\\";
  const parts = browsePath.slice(base.length).split(/[\\/]/).filter(Boolean);
  return [
    { label: rootName, path: rootPath },
    ...parts.map((label, i) => ({ label, path: base + sep + parts.slice(0, i + 1).join(sep) })),
  ];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openFile(path: string) {
  void db.openObjectPath(path).catch((error) => showToast(`打开失败：${errorText(error)}`, "error"));
}

function openInExplorer(path: string) {
  void db.openInExplorer(path).catch((error) => showToast(`打开失败：${errorText(error)}`, "error"));
}

export function FolderPreviewBody({
  item,
  info,
  onTagSelect,
  onAddItems,
}: {
  item: ItemWithTags;
  info: db.ObjectPreviewFileInfo | null;
  onTagSelect: (tagId: number) => void;
  onAddItems?: (paths: string[]) => Promise<void>;
}) {
  const modified = info?.modified_at_secs ? formatLocalDate(info.modified_at_secs) : "未知";
  const [browsePath, setBrowsePath] = useState(item.path);
  const [entries, setEntries] = useState<db.ObjectDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    setActiveIndex(0);
    db.listObjectDirectory(browsePath)
      .then((listed) => {
        if (!cancelled) setEntries(listed);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browsePath]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => entries[index]?.path ?? index,
    overscan: 8,
  });

  const crumbs = breadcrumbs(item.path, item.name, browsePath);

  const enter = (path: string) => {
    setBrowsePath(path);
    scrollRef.current?.focus();
  };

  const activate = (entry: db.ObjectDirectoryEntry) => {
    if (entry.is_dir) enter(entry.path);
    else openFile(entry.path);
  };

  const moveTo = (index: number) => {
    if (entries.length === 0) return;
    const next = Math.max(0, Math.min(entries.length - 1, index));
    setActiveIndex(next);
    virtualizer.scrollToIndex(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 焦点在行内按钮上时 Enter/空格交给按钮本身
    if (event.target !== event.currentTarget && (event.key === "Enter" || event.key === " ")) return;
    if (event.key === "Backspace" || (event.altKey && event.key === "ArrowLeft")) {
      event.preventDefault();
      if (crumbs.length > 1) enter(crumbs[crumbs.length - 2].path);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveTo(event.key === "Home" ? 0 : entries.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[activeIndex];
      if (entry) activate(entry);
    }
  };

  return (
    <div className="preview-folder-body">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 text-[13px] text-[var(--text-muted)]">
        <span className="data-readout text-[var(--text-secondary)]">{loading ? "…" : entries.length} 项</span>
        <span aria-hidden="true">·</span>
        <span>修改 {modified}</span>
        {item.tags.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <PreviewTagPills tags={item.tags} onTagSelect={onTagSelect} />
          </>
        )}
      </div>
      <nav aria-label="当前位置" className="flex shrink-0 flex-wrap items-center gap-0.5 px-4 pb-1.5 text-[12px]">
        {crumbs.map((crumb, i) => {
          const current = i === crumbs.length - 1;
          return (
            <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight aria-hidden="true" size={12} className="shrink-0 text-[var(--text-faint)]" />}
              {current ? (
                <span aria-current="location" className="truncate px-1 text-[var(--text-secondary)]">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="truncate rounded px-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  onClick={() => enter(crumb.path)}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>
      <p className="preview-folder-hint shrink-0 px-4 pb-2">
        仅预览目录内容，不会自动加入库
        {entries.length >= MAX_ENTRIES ? ` · 仅显示前 ${MAX_ENTRIES} 项` : ""}
      </p>
      {error && <p className="px-4 py-2 text-sm text-[var(--color-danger-ink)]">{error}</p>}
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label="目录内容"
        className="preview-folder-list outline-none"
        onKeyDown={handleKeyDown}
      >
        {!loading && !error && entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--text-muted)]">空文件夹</p>
        ) : (
          <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const entry = entries[row.index];
              const { Icon, className } = entryIcon(entry);
              const active = row.index === activeIndex;
              return (
                <li
                  key={row.key}
                  data-active={active ? "" : undefined}
                  className={`group absolute inset-x-0 top-0 flex items-center gap-2 px-4 ${entry.is_dir ? "cursor-pointer" : ""} ${active ? "bg-[var(--bg-hover)]" : ""}`}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
                  onClick={() => {
                    setActiveIndex(row.index);
                    if (entry.is_dir) enter(entry.path);
                  }}
                >
                  <Icon aria-hidden="true" size={15} strokeWidth={1.8} className={className} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{entry.name}</span>
                  <div
                    className={`flex shrink-0 items-center gap-1 group-hover:opacity-100 group-focus-within:opacity-100 ${active ? "opacity-100" : "opacity-0"}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="action-button h-7 min-h-7 shrink-0 px-2 text-[12px]"
                      onClick={() => (entry.is_dir ? openInExplorer(entry.path) : openFile(entry.path))}
                    >
                      打开
                    </button>
                    {!entry.is_dir && (
                      <button
                        type="button"
                        className="action-button h-7 min-h-7 shrink-0 px-2 text-[12px]"
                        onClick={() => openInExplorer(entry.path)}
                      >
                        打开所在文件夹
                      </button>
                    )}
                    {onAddItems && (
                      <button
                        type="button"
                        className="action-button h-7 min-h-7 shrink-0 px-2 text-[12px]"
                        onClick={() => {
                          void onAddItems([entry.path]).catch((error) => {
                            showToast(`加入库失败：${errorText(error)}`, "error");
                          });
                        }}
                      >
                        <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
                        加入库
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

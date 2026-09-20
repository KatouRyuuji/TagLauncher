// ============================================================================
// components/preview/FolderPreviewBody.tsx — 夹：目录是主体
// ============================================================================
// 属性缩成顶上一行；行内「打开 / 加入库」悬停或聚焦才浮出。
// ============================================================================

import { File, Folder, Plus } from "lucide-react";
import * as db from "../../lib/db";
import { showToast } from "../../lib/toast";
import type { ItemWithTags } from "../../types";
import { formatLocalDate } from "./previewFormat";
import { PreviewTagPills } from "./PreviewTagPills";

export function FolderPreviewBody({
  item,
  info,
  entries,
  entryTotal,
  onTagSelect,
  onAddItems,
}: {
  item: ItemWithTags;
  info: db.ObjectPreviewFileInfo | null;
  entries: db.ObjectDirectoryEntry[];
  entryTotal: number;
  onTagSelect: (tagId: number) => void;
  onAddItems?: (paths: string[]) => Promise<void>;
}) {
  const modified = info?.modified_at_secs ? formatLocalDate(info.modified_at_secs) : "未知";

  return (
    <div className="preview-folder-body">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 text-[13px] text-[var(--text-muted)]">
        <span className="data-readout text-[var(--text-secondary)]">{entryTotal} 项</span>
        <span aria-hidden="true">·</span>
        <span>修改 {modified}</span>
        {item.tags.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <PreviewTagPills tags={item.tags} onTagSelect={onTagSelect} />
          </>
        )}
      </div>
      <p className="preview-folder-hint shrink-0 px-4 pb-2">
        仅预览目录内容，不会自动加入库（最多 48 项）
        {entryTotal > 48 ? " · 还有更多" : ""}
      </p>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--text-muted)]">空文件夹或无法列出</p>
      ) : (
        <ul className="preview-folder-list">
          {entries.map((entry) => (
            <li key={entry.path} className="group flex min-h-9 items-center gap-2 px-4 py-1.5">
              {entry.is_dir ? (
                <Folder aria-hidden="true" size={15} strokeWidth={1.8} className="shrink-0 text-[var(--color-warning-ink)]" />
              ) : (
                <File aria-hidden="true" size={15} strokeWidth={1.8} className="shrink-0 text-[var(--text-faint)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{entry.name}</span>
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  className="action-button h-7 min-h-7 shrink-0 px-2 text-[12px]"
                  onClick={() => {
                    void db.openInExplorer(entry.path).catch((error) => {
                      showToast(`打开失败：${error instanceof Error ? error.message : String(error)}`, "error");
                    });
                  }}
                >
                  打开
                </button>
                {onAddItems && (
                  <button
                    type="button"
                    className="action-button h-7 min-h-7 shrink-0 px-2 text-[12px]"
                    onClick={() => {
                      void onAddItems([entry.path]).catch((error) => {
                        showToast(`加入库失败：${error instanceof Error ? error.message : String(error)}`, "error");
                      });
                    }}
                  >
                    <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
                    加入库
                  </button>
                )}
              </div>
            </li>
          ))}
          {/* 列表末尾汇总总数，滚动到底可确认没有遗漏 */}
          <li className="px-4 py-1.5 text-[12px] text-[var(--text-faint)]">
            共 {entryTotal} 项{entryTotal > 48 ? " · 还有更多" : ""}
          </li>
        </ul>
      )}
    </div>
  );
}

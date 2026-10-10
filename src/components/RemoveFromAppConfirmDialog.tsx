import { useEffect, useRef } from "react";
import { Check, Trash2 } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { RemoveConfirmItem, RemoveFromAppMode } from "../hooks/useItemRemoval";
import type { UntrackPlan } from "../lib/untrack";
import {
  deleteFilesDialogTitle,
  folderTypeBadge,
  removeFromLibraryDialogTitle,
} from "../lib/itemActionCopy";
import { truncatePathMiddle } from "../lib/itemUtils";

/** 从库移除确认：可选仅从库中移除（监视 / 关联文件夹内的对象为「不再追踪」），或连本地文件一起移到回收站。 */
export function RemoveFromAppConfirmDialog({
  open,
  items,
  busyLabel = null,
  skipNextTime,
  preferDeleteFiles,
  untrack = { untrackedCount: 0, extraIds: [] },
  onSkipNextTimeChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  items: RemoveConfirmItem[];
  busyLabel?: string | null;
  skipNextTime: boolean;
  preferDeleteFiles: boolean;
  untrack?: UntrackPlan;
  onSkipNextTimeChange: (value: boolean) => void;
  onConfirm: (mode: RemoveFromAppMode) => Promise<void>;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onCancel, open && !busyLabel);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // 危险确认弹窗的初始焦点落在安全主按钮（焦点陷阱默认抓第一个可聚焦元素，
  // 会把焦点放到「不再询问」复选框上，误按空格勾掉下次确认）
  useEffect(() => {
    if (open && !preferDeleteFiles) primaryRef.current?.focus();
  }, [open, preferDeleteFiles]);

  if (!open) return null;

  const itemCount = items.length;
  const dialogTitle = preferDeleteFiles
    ? deleteFilesDialogTitle(itemCount)
    : removeFromLibraryDialogTitle(itemCount);
  const folderCount = items.filter((item) => item.type === "folder").length;
  const previewItems = items.slice(0, 3);
  const untracking = untrack.untrackedCount > 0;
  const libraryLabel = untracking ? "不再追踪" : "从库中移除";

  return (
    <>
      <div
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-overlay)" }}
        onClick={onCancel}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: "var(--z-editor-panel)" }}
      >
        <div
          ref={trapRef}
          className="modal-surface pointer-events-auto w-[480px] max-w-[92vw] p-6"
          role="dialog"
          aria-modal="true"
          aria-label={dialogTitle}
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] text-[var(--color-danger-ink)]">
              <Trash2 aria-hidden="true" size={19} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {busyLabel ?? dialogTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                从库中移除不会动磁盘上的文件。删除本地文件会把磁盘上的文件或整个文件夹移到回收站，并从库里拿掉。
              </p>
              {untracking && (
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  {untrack.untrackedCount === itemCount ? "这些对象" : `其中 ${untrack.untrackedCount} 项`}位于监视或关联的文件夹里：不再追踪会把它们移出库，文件留在磁盘上，之后也不会自动导入，可在「已忽略」里恢复。
                  {untrack.extraIds.length > 0 && `文件夹连同其下已入库的 ${untrack.extraIds.length} 项一起移出。`}
                </p>
              )}
              {folderCount > 0 && (
                <p className="mt-2 text-sm leading-6 text-[var(--color-danger-ink)]">
                  其中有 {folderCount} 个文件夹：删除本地文件会把整个目录树送进回收站。
                </p>
              )}
            </div>
          </div>

          {previewItems.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] px-3 py-2">
              {previewItems.map((item) => (
                <li key={`${item.path}-${item.name}`} className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.name}</span>
                    {item.type === "folder" && (
                      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{folderTypeBadge}</span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-[var(--text-faint)]" title={item.path}>
                    {truncatePathMiddle(item.path, 56)}
                  </p>
                </li>
              ))}
              {itemCount > previewItems.length && (
                <li className="text-[12px] text-[var(--text-muted)]">等 {itemCount} 项</li>
              )}
            </ul>
          )}

          {!untracking && <button
            type="button"
            onClick={() => onSkipNextTimeChange(!skipNextTime)}
            aria-pressed={skipNextTime}
            className="mt-5 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-input)]">
              {skipNextTime && (
                <Check aria-hidden="true" size={12} strokeWidth={2} className="text-[var(--accent-primary)]" />
              )}
            </span>
            从库中移除时不再询问（删除本地文件仍会逐次确认）
          </button>}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {!preferDeleteFiles && (
              <button
                type="button"
                onClick={() => void onConfirm("files")}
              disabled={busyLabel != null}
                className="action-button action-button-danger mr-auto"
              >
                <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                删除本地文件（进回收站）
              </button>
            )}
            <button type="button" autoFocus={preferDeleteFiles} onClick={onCancel} disabled={busyLabel != null} className="action-button">
              取消
            </button>
            <button
              type="button"
              ref={primaryRef}
              autoFocus={!preferDeleteFiles}
              onClick={() => void onConfirm("library")}
              disabled={busyLabel != null}
              className={preferDeleteFiles ? "action-button" : "action-button action-button-primary"}
            >
              {libraryLabel}
            </button>
            {preferDeleteFiles && (
              <button
                type="button"
                onClick={() => void onConfirm("files")}
              disabled={busyLabel != null}
                className="action-button action-button-danger"
              >
                <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                删除本地文件（进回收站）
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

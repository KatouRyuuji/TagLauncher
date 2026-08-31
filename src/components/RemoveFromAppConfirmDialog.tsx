import { Check, Trash2 } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";

/** 拖拽对象到"从应用移除"区时的确认弹窗（带"下次不再确认"） */
export function RemoveFromAppConfirmDialog({
  open,
  itemCount,
  skipNextTime,
  onSkipNextTimeChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  itemCount: number;
  skipNextTime: boolean;
  onSkipNextTimeChange: (value: boolean) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onCancel, open);

  if (!open) return null;

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
          className="modal-surface pointer-events-auto w-[420px] max-w-[92vw] p-6"
          role="dialog"
          aria-modal="true"
          aria-label="移除对象确认"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
              <Trash2 aria-hidden="true" size={19} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-label">Confirm</div>
              <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
                这会使得{itemCount > 1 ? `${itemCount} 个对象` : "对象"}在应用内被移除（不删除本地文件），是否确认？
              </p>
            </div>
          </div>

          <button
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
            下次不再确认
          </button>

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" autoFocus onClick={onCancel} className="action-button">
              取消
            </button>
            <button type="button" onClick={() => void onConfirm()} className="action-button action-button-primary">
              <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
              确认移除
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

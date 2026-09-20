import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { relocateNoneCopy, relocateRecoveredCopy } from "../lib/itemActionCopy";
import { compareNames } from "../lib/itemQuery";
import { truncatePathMiddle } from "../lib/itemUtils";
import type { ItemWithTags } from "../types";
import { DialogHeader } from "./DialogHeader";
import { ItemVisualIcon } from "./ItemVisualIcon";

export function MissingItemsReviewDialog({
  open,
  items,
  relocating,
  lastRelocateResult,
  onClose,
  onRelocate,
  onRemove,
}: {
  open: boolean;
  items: ItemWithTags[];
  relocating: boolean;
  lastRelocateResult: number | null;
  onClose: () => void;
  onRelocate: () => Promise<void>;
  onRemove: (ids: number[]) => Promise<void>;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onClose, open);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [removing, setRemoving] = useState(false);

  const ordered = useMemo(
    () => [...items].sort((a, b) => compareNames(a.name, b.name)),
    [items],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedIds(items.map((item) => item.id));
  }, [open, items]);

  if (!open) return null;

  const selectedSet = new Set(selectedIds);
  const allChecked = ordered.length > 0 && ordered.every((item) => selectedSet.has(item.id));
  const someChecked = selectedIds.length > 0;

  const toggleAll = () => {
    setSelectedIds(allChecked ? [] : ordered.map((item) => item.id));
  };

  const toggleOne = (id: number) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    ));
  };

  const handleRemove = async () => {
    if (selectedIds.length === 0 || removing) return;
    setRemoving(true);
    try {
      await onRemove(selectedIds);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-overlay)" }}
        onClick={onClose}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: "var(--z-editor-panel)" }}
      >
        <div
          ref={trapRef}
          className="modal-surface pointer-events-auto flex max-h-[min(720px,86vh)] w-[560px] max-w-[92vw] flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="失效项目"
        >
          <div className="px-5 pt-5">
            <DialogHeader
              title="失效项目"
              description="这些项目的文件当前找不到（U 盘拔出也会出现在这里）。找回会扫描全部失效项；移除只作用于已勾选，不会再删一次本地已经不在的文件。"
              onClose={onClose}
              icon={
                <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[var(--status-warning-bg)] text-[var(--color-warning-ink)]">
                  <TriangleAlert size={18} strokeWidth={1.8} aria-hidden="true" />
                </span>
              }
            />
            {lastRelocateResult !== null && (
              <p
                role="status"
                className={
                  lastRelocateResult === 0
                    ? "mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-ink)]"
                    : "mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success)_28%,transparent)] bg-[var(--status-success-bg)] px-3 py-2 text-sm text-[var(--color-success-ink)]"
                }
              >
                {lastRelocateResult === 0 ? relocateNoneCopy() : relocateRecoveredCopy(lastRelocateResult)}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-y border-[var(--line-hairline)] px-5 py-2.5">
            <button
              type="button"
              onClick={toggleAll}
              aria-pressed={allChecked}
              className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {/* 框体表达状态（含半选），文案恒为动作名「全选」，不与勾选态打架 */}
              <CheckBox checked={allChecked} indeterminate={someChecked && !allChecked} />
              全选
            </button>
            <span className="data-readout text-[13px] text-[var(--text-faint)]">
              已选 {selectedIds.length} / {ordered.length}
            </span>
          </div>

          {/* 高度随内容自适应：条目少时对话框收缩，不留列表区死白；多到 46vh 才内滚动 */}
          <ul className="min-h-0 max-h-[46vh] overflow-y-auto px-2 py-2" aria-label="失效项目列表">
            {ordered.map((item) => {
              const checked = selectedSet.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggleOne(item.id)}
                    aria-pressed={checked}
                    className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left ${
                      checked ? "bg-[var(--accent-primary-bg-light)]" : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <CheckBox checked={checked} />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)]">
                      <ItemVisualIcon item={item} emojiClass="leading-none" imageClass="h-full w-full object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.name}</span>
                        <TriangleAlert className="h-3 w-3 shrink-0 text-[var(--color-warning-ink)]" aria-hidden="true" />
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--text-faint)] line-through" title={item.path}>
                        {truncatePathMiddle(item.path, 56)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* 危险居左弱化、安全居右：与批量移除确认同一套肌肉记忆 */}
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line-hairline)] px-5 py-4">
            <button
              type="button"
              className="action-button action-button-danger mr-auto"
              disabled={!someChecked || removing}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              从库中移除已勾选
            </button>
            <button type="button" className="action-button" onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="action-button action-button-primary"
              disabled={relocating || ordered.length === 0}
              onClick={() => void onRelocate()}
            >
              {relocating && (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              {relocating ? "正在扫描…" : lastRelocateResult === 0 ? "重新扫描全部失效项" : "尝试找回全部失效项"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CheckBox({ checked, indeterminate = false }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-input)]">
      {checked && <Check aria-hidden="true" size={12} strokeWidth={2} className="text-[var(--accent-primary)]" />}
      {!checked && indeterminate && (
        <span aria-hidden="true" className="h-0.5 w-2 rounded-full bg-[var(--accent-primary)]" />
      )}
    </span>
  );
}

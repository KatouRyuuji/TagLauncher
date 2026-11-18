import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { relocateCandidatesCopy, relocateNoneCopy, relocateRecoveredCopy } from "../lib/itemActionCopy";
import type { RelocateCandidate, RelocateChoice } from "../lib/db";
import { compareNames } from "../lib/itemQuery";
import { truncatePathMiddle } from "../lib/itemUtils";
import { showToast } from "../lib/toast";
import { formatScanProgress, type RelocateProgress } from "../lib/relocateScan";
import type { ItemWithTags } from "../types";
import { DialogHeader } from "./DialogHeader";
import { ItemVisualIcon } from "./ItemVisualIcon";

const EMPTY_RELOCATE_CANDIDATES: RelocateCandidate[] = [];

export function MissingItemsReviewDialog({
  open,
  items,
  relocating,
  lastRelocateResult,
  relocateCandidates = EMPTY_RELOCATE_CANDIDATES,
  onClose,
  onRelocate,
  onConfirmRelocations,
  onPickRelocateRoots,
  scanProgress = null,
  relocateNote = null,
  onStopScan,
  onRemove,
}: {
  open: boolean;
  items: ItemWithTags[];
  relocating: boolean;
  lastRelocateResult: number | null;
  relocateCandidates?: RelocateCandidate[];
  onClose: () => void;
  /** roots 省略 = 全部盘符；给定 = 只在这些文件夹内扫描候选 */
  onRelocate: (roots?: string[]) => Promise<void>;
  onConfirmRelocations?: (choices: RelocateChoice[]) => Promise<number>;
  /** 选择找回范围（原生文件夹对话框）；返回 null 表示取消 */
  onPickRelocateRoots: () => Promise<string[] | null>;
  /** 在途找回扫描的最新进度（自动或手动触发均会显示）；null = 没有在扫描 */
  scanProgress?: RelocateProgress | null;
  /** 停止 / 超时 / 失败说明 */
  relocateNote?: { kind: "info" | "warning"; text: string } | null;
  onStopScan?: () => Promise<void> | void;
  onRemove: (ids: number[]) => Promise<void>;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onClose, open);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [removing, setRemoving] = useState(false);
  const [chosenPaths, setChosenPaths] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setChosenPaths((current) => {
      const next: Record<number, string> = {};
      for (const candidate of relocateCandidates) {
        next[candidate.id] = current[candidate.id] && candidate.paths.includes(current[candidate.id])
          ? current[candidate.id]
          : candidate.paths[0] ?? "";
      }
      return next;
    });
  }, [relocateCandidates]);

  const handlePickAndRelocate = async () => {
    let roots: string[] | null;
    try {
      roots = await onPickRelocateRoots();
    } catch (err) {
      showToast(`无法打开文件夹选择：${err instanceof Error ? err.message : String(err)}`, "error");
      return;
    }
    if (roots && roots.length > 0) await onRelocate(roots);
  };

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
            {relocateCandidates.length > 0 && (
              <div
                role="status"
                data-testid="relocate-candidates"
                className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-ink)]"
              >
                <p>{relocateCandidatesCopy(relocateCandidates.length)}</p>
                <ul className="mt-2 space-y-2">
                  {relocateCandidates.map((candidate) => (
                    <li key={candidate.id} className="flex flex-col gap-1">
                      <span className="text-xs opacity-80" title={candidate.missingPath}>
                        原路径：{truncatePathMiddle(candidate.missingPath, 64)}
                      </span>
                      <label className="flex flex-col gap-1">
                        <span className="sr-only">为失效项 {candidate.id} 选择候选路径</span>
                        <select
                          data-testid={`relocate-candidate-${candidate.id}`}
                          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs"
                          value={chosenPaths[candidate.id] ?? candidate.paths[0] ?? ""}
                          onChange={(event) =>
                            setChosenPaths((current) => ({ ...current, [candidate.id]: event.target.value }))
                          }
                        >
                          {candidate.paths.map((path) => (
                            <option key={path} value={path}>
                              {path}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {lastRelocateResult !== null && relocateCandidates.length === 0 && (
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
            {relocateNote && (
              <p
                role={relocateNote.kind === "warning" ? "alert" : "status"}
                data-testid="relocate-note"
                className={
                  relocateNote.kind === "warning"
                    ? "mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_28%,transparent)] bg-[var(--status-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-ink)]"
                    : "mt-3 rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)]"
                }
              >
                {relocateNote.text}
              </p>
            )}
            {scanProgress && (
              <div
                role="status"
                aria-live="polite"
                data-testid="relocate-progress"
                className="mt-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line-hairline)] px-3 py-2 text-sm text-[var(--text-secondary)]"
              >
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {scanProgress.scoped ? "正在选定文件夹中找回：" : "正在全盘找回："}
                  {formatScanProgress(scanProgress)}
                </span>
                {onStopScan && (
                  <button type="button" className="action-button shrink-0" onClick={() => void onStopScan()}>
                    停止扫描
                  </button>
                )}
              </div>
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
            <span className="data-readout text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
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
                      <span className="mt-0.5 block truncate text-[length:calc(12px*var(--ui-font-scale,1))] text-[var(--text-faint)] line-through" title={item.path}>
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
            <button
              type="button"
              className="action-button action-button-primary"
              data-testid="relocate-confirm"
              disabled={relocating || confirming || relocateCandidates.length === 0 || !onConfirmRelocations}
              onClick={() => {
                void (async () => {
                  if (!onConfirmRelocations) return;
                  const choices = relocateCandidates
                    .map((candidate) => ({
                      id: candidate.id,
                      path: chosenPaths[candidate.id] ?? candidate.paths[0] ?? "",
                    }))
                    .filter((choice) => choice.path);
                  if (choices.length === 0) return;
                  setConfirming(true);
                  try {
                    const recovered = await onConfirmRelocations(choices);
                    if (recovered === 0) {
                      showToast("确认后未能回写，候选可能已变化，请重新扫描", "warning");
                    }
                  } catch (error) {
                    showToast(`确认找回失败：${error instanceof Error ? error.message : String(error)}`, "error");
                  } finally {
                    setConfirming(false);
                  }
                })();
              }}
            >
              {confirming ? "正在确认…" : "确认找回所选"}
            </button>
            <button type="button" className="action-button" onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="action-button"
              disabled={relocating || ordered.length === 0}
              title="只扫描你选定的文件夹（比全盘快得多）；唯一性也只在这些文件夹内核验"
              onClick={() => void handlePickAndRelocate()}
            >
              在选定文件夹中找回…
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

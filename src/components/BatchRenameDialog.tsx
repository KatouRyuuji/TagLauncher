import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ItemWithTags } from "../types";
import type { RenameFailure, RenameReport } from "../lib/db";
import { renameItems } from "../lib/db";
import { planBatchRename, type BatchRenamePlan, type BatchRenameRule, type BatchRenameStatus } from "../lib/batchRename";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { DialogHeader } from "./DialogHeader";
import { SelectMenu } from "./SelectMenu";
import { useAppStore } from "../stores/appStore";

const CHECK_DELAY_MS = 200;
const MAX_PAD = 10;

type RuleKind = "replace" | "template";

interface BatchRenameDialogProps {
  items: ItemWithTags[];
  onExecute: (renames: Array<{ id: number; newName: string }>) => Promise<RenameReport>;
  onUndo: () => Promise<void>;
  onClose: () => void;
}

function statusLabel(status: BatchRenameStatus, backendError?: string): string {
  if (status === "missing") return "失效，跳过";
  if (status === "duplicate") return "批内重名";
  if (status === "unchanged") return "不变";
  if (backendError) return backendError;
  return "将改名";
}

function statusTone(status: BatchRenameStatus, backendError?: string): string {
  if (status === "rename" && !backendError) return "text-[var(--text-secondary)]";
  if (status === "unchanged") return "text-[var(--text-faint)]";
  return "text-[var(--color-danger-ink)]";
}

/** 批量重命名：规则预览、后端 dry_run 校验、执行后结果摘要与撤销。 */
export function BatchRenameDialog({ items: initialItems, onExecute, onUndo, onClose }: BatchRenameDialogProps) {
  // 打开时固定目标与顺序：执行后列表重载、名称与排序变化都不影响预览和结果
  const [items] = useState(initialItems);
  const [kind, setKind] = useState<RuleKind>("replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [template, setTemplate] = useState("{name}-{n}");
  const [start, setStart] = useState(1);
  const [pad, setPad] = useState(0);
  const [includeExtension, setIncludeExtension] = useState(false);
  // 后端校验结果绑定到它所校验的预览；规则一变旧结果立即作废，不会错配到新名称上
  const [check, setCheck] = useState<{ plan: BatchRenamePlan; errors: Map<number, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ report: RenameReport; canUndo: boolean } | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, autoFocus: true });

  const rule = useMemo<BatchRenameRule>(() => {
    if (kind === "replace") return { kind, find, replace, regex, caseSensitive, includeExtension };
    return { kind, template, start: Number.isFinite(start) ? start : 1, pad: Math.min(MAX_PAD, Math.max(0, pad | 0)), includeExtension };
  }, [kind, find, replace, regex, caseSensitive, template, start, pad, includeExtension]);

  const plan = useMemo(() => planBatchRename(items, rule), [items, rule]);

  useEffect(() => {
    if (result) return;
    const candidates = plan.rows.filter((row) => row.status === "rename").map((row) => ({ id: row.id, newName: row.newName }));
    if (plan.error || candidates.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renameItems(candidates, true)
        .then((report) => {
          if (cancelled) return;
          setCheck({ plan, errors: new Map(report.failed.map((failure: RenameFailure) => [failure.id, failure.error])) });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setCheck({ plan, errors: new Map(candidates.map((row) => [row.id, message])) });
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [plan, result]);

  const backendErrors = check?.plan === plan ? check.errors : new Map<number, string>();
  const runnable = plan.rows.filter((row) => row.status === "rename" && !backendErrors.has(row.id));
  const handleClose = () => {
    if (!busy) onClose();
  };
  useEscapeKey(handleClose);

  const handleExecute = async () => {
    if (busy || plan.error || runnable.length === 0) return;
    setBusy(true);
    try {
      const report = await onExecute(runnable.map((row) => ({ id: row.id, newName: row.newName })));
      const successIds = new Set(report.renamed.map((entry) => entry.id));
      const undoEntries = plan.rows
        .filter((row) => successIds.has(row.id))
        .map((row) => ({ id: row.id, oldName: row.oldName }));
      useAppStore.getState().setLastBatchRename(undoEntries);
      setResult({ report, canUndo: undoEntries.length > 0 });
    } catch {
      // 失败提示由 withErrorToast 统一弹出；弹窗保持打开便于修改规则。
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    if (busy || !result?.canUndo) return;
    setBusy(true);
    try {
      await onUndo();
    } catch {
      // 失败提示由 withErrorToast 统一弹出；撤销记录保留，可再次撤销。
    } finally {
      setResult((current) => (current ? { ...current, canUndo: useAppStore.getState().lastBatchRename !== null } : current));
      setBusy(false);
    }
  };

  return createPortal(
    <div
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-panel)" }}
      onClick={handleClose}
    >
      <div
        ref={trapRef}
        className="modal-surface dialog-panel flex max-h-[min(90vh,720px)] w-[720px] max-w-[calc(100vw-2rem)] flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="批量重命名"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader
          title={result ? "批量重命名结果" : `批量重命名（${items.length} 项）`}
          onClose={handleClose}
          disabled={busy}
        />

        {result ? (
          <div className="dialog-body flex min-h-0 flex-1 flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              成功 {result.report.renamed.length} / 失败 {result.report.failed.length}
            </p>
            {result.report.failed.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-2 text-xs text-[var(--color-danger-ink)]">
                {result.report.failed.map((failure) => {
                  const name = items.find((item) => item.id === failure.id)?.name ?? `id ${failure.id}`;
                  return (
                    <li key={failure.id} className="truncate py-0.5" title={`${name}：${failure.error}`}>
                      {name}：{failure.error}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="dialog-footer mt-auto justify-end gap-2 border-0 p-0">
              {result.canUndo && (
                <button type="button" disabled={busy} onClick={() => void handleUndo()} className="action-button">
                  撤销这次重命名
                </button>
              )}
              <button type="button" disabled={busy} onClick={handleClose} className="action-button action-button-primary">
                完成
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="dialog-body flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2">
                <SelectMenu
                  ariaLabel="规则类型"
                  value={kind}
                  onChange={(value) => setKind(value as RuleKind)}
                  options={[
                    { value: "replace", label: "查找替换" },
                    { value: "template", label: "模板" },
                  ]}
                  className="action-button min-h-8 px-2.5 text-xs"
                  disabled={busy}
                />
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--text-faint)]">
                  <input
                    type="checkbox"
                    checked={includeExtension}
                    disabled={busy}
                    onChange={(event) => setIncludeExtension(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
                  />
                  同时修改扩展名
                </label>
              </div>

              {kind === "replace" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label="查找"
                    placeholder="查找"
                    value={find}
                    disabled={busy}
                    spellCheck={false}
                    onChange={(event) => setFind(event.target.value)}
                    className="input-frame w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm"
                  />
                  <input
                    aria-label="替换为"
                    placeholder="替换为"
                    value={replace}
                    disabled={busy}
                    spellCheck={false}
                    onChange={(event) => setReplace(event.target.value)}
                    className="input-frame w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm"
                  />
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-faint)]">
                    <input type="checkbox" checked={regex} disabled={busy} onChange={(event) => setRegex(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent-primary)]" />
                    正则表达式
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-faint)]">
                    <input type="checkbox" checked={caseSensitive} disabled={busy} onChange={(event) => setCaseSensitive(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent-primary)]" />
                    区分大小写
                  </label>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    aria-label="模板"
                    placeholder="{name}-{n}"
                    value={template}
                    disabled={busy}
                    spellCheck={false}
                    onChange={(event) => setTemplate(event.target.value)}
                    className="input-frame w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm"
                  />
                  <label className="flex items-center gap-1 text-xs text-[var(--text-faint)]">
                    起始
                    <input
                      aria-label="序号起始值"
                      type="number"
                      value={start}
                      disabled={busy}
                      onChange={(event) => setStart(Number(event.target.value))}
                      className="input-frame w-16 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-[var(--text-faint)]">
                    补零
                    <input
                      aria-label="序号补零位数"
                      type="number"
                      min={0}
                      max={MAX_PAD}
                      value={pad}
                      disabled={busy}
                      onChange={(event) => setPad(Number(event.target.value))}
                      className="input-frame w-16 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-1.5 text-sm"
                    />
                  </label>
                  <p className="sm:col-span-3 text-xs text-[var(--text-faint)]">{"{name}"} 为原主文件名，{"{n}"} 为序号（按当前显示顺序）</p>
                </div>
              )}

              {plan.error ? (
                <p role="alert" className="text-xs text-[var(--color-danger-ink)]">{plan.error}</p>
              ) : null}

              <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-[var(--bg-surface)] text-[var(--text-faint)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">原名</th>
                      <th className="px-3 py-2 font-medium">新名</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((row) => {
                      const backendError = row.status === "rename" ? backendErrors.get(row.id) : undefined;
                      return (
                        <tr key={row.id} className="border-t border-[var(--border-subtle)]">
                          <td className="max-w-[12rem] truncate px-3 py-1.5 text-[var(--text-secondary)]" title={row.oldName}>{row.oldName}</td>
                          <td className="max-w-[12rem] truncate px-3 py-1.5 text-[var(--text-primary)]" title={row.newName}>{row.newName}</td>
                          <td className={`px-3 py-1.5 ${statusTone(row.status, backendError)}`}>{statusLabel(row.status, backendError)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="dialog-footer justify-end gap-2">
              <button type="button" disabled={busy} onClick={handleClose} className="action-button">
                取消
              </button>
              <button
                type="button"
                disabled={busy || !!plan.error || runnable.length === 0}
                onClick={() => void handleExecute()}
                className="action-button action-button-primary disabled:opacity-40"
              >
                {busy ? "执行中…" : `执行（${runnable.length}）`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

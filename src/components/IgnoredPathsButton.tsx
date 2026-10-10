// ============================================================================
// components/IgnoredPathsButton.tsx — 「已忽略 N 项」入口与恢复追踪弹窗
// ============================================================================
// 忽略名单为空时不渲染。under 给定时只列该监视目录之下的项（关联柜状态栏），
// 缺省列全部（设置页「文件夹监视」）。恢复后后端重载监视并补扫，对象自动回到库里。
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, EyeOff } from "lucide-react";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";
import { IGNORED_PATHS_CHANGED_EVENT, notifyIgnoredPathsChanged } from "../lib/untrack";
import { truncatePathMiddle } from "../lib/itemUtils";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function IgnoredPathsButton({ under, className }: { under?: string; className?: string }) {
  const [paths, setPaths] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    void db.listIgnoredPaths(under).then(setPaths, () => {});
  }, [under]);

  useEffect(() => {
    load();
    window.addEventListener(IGNORED_PATHS_CHANGED_EVENT, load);
    // 手动把被忽略的路径加回库时后端解除忽略
    window.addEventListener("taglauncher-items-added", load);
    return () => {
      window.removeEventListener(IGNORED_PATHS_CHANGED_EVENT, load);
      window.removeEventListener("taglauncher-items-added", load);
    };
  }, [load]);

  if (paths.length === 0 && !open) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { load(); setOpen(true); }}
        className={className ?? "control-chip h-7 min-h-7 shrink-0 gap-1.5 px-2.5 text-[13px]"}
      >
        <EyeOff aria-hidden="true" size={14} strokeWidth={1.8} />
        已忽略 {paths.length} 项
      </button>
      {open && createPortal(<IgnoredPathsDialog paths={paths} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function IgnoredPathsDialog({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true });
  useEscapeKey(onClose, !busy);

  const allChecked = paths.length > 0 && paths.every((path) => checked.has(path));
  const toggle = (path: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const restore = async () => {
    const selected = paths.filter((path) => checked.has(path));
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await db.restoreIgnoredPaths(selected);
      notifyIgnoredPathsChanged();
      showToast(`已恢复追踪 ${selected.length} 项，稍后自动导入`, "success");
      onClose();
    } catch (error) {
      showToast(`恢复追踪失败：${error instanceof Error ? error.message : String(error)}`, "error");
      setBusy(false);
    }
  };

  return (
    <>
      <div
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-overlay)" }}
        onClick={busy ? undefined : onClose}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: "var(--z-editor-panel)" }}
      >
        <div
          ref={trapRef}
          className="modal-surface pointer-events-auto w-[520px] max-w-[92vw] p-6"
          role="dialog"
          aria-modal="true"
          aria-label="已忽略的对象"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)]">已忽略的对象</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            这些文件或文件夹不再自动导入。恢复追踪后，监视会把它们重新导入库里。
          </p>
          <ul className="mt-4 max-h-[50vh] space-y-0.5 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] p-1.5">
            {paths.length > 1 && (
              <li>
                <CheckRow
                  checked={allChecked}
                  label="全选"
                  onClick={() => setChecked(allChecked ? new Set() : new Set(paths))}
                />
              </li>
            )}
            {paths.map((path) => (
              <li key={path}>
                <CheckRow checked={checked.has(path)} label={truncatePathMiddle(path, 64)} title={path} onClick={() => toggle(path)} />
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="action-button">
              关闭
            </button>
            <button
              type="button"
              onClick={() => void restore()}
              disabled={busy || checked.size === 0}
              className="action-button action-button-primary disabled:opacity-50"
            >
              {busy ? "正在恢复…" : `恢复追踪（${checked.size}）`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CheckRow({ checked, label, title, onClick }: { checked: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-input)]">
        {checked && <Check aria-hidden="true" size={12} strokeWidth={2} className="text-[var(--accent-primary)]" />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ItemWithTags } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { renameItems } from "../lib/db";
import { isImeKeyboardEvent } from "../lib/itemQuery";
import { DialogHeader } from "./DialogHeader";

/** 输入停顿多久后向后端预检（dry_run）。 */
const CHECK_DELAY_MS = 200;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

interface RenameDialogProps {
  item: ItemWithTags;
  onSave: (newName: string) => Promise<void>;
  onClose: () => void;
}

/** 单个对象重命名：磁盘与库内同步改名；Enter 保存，Esc 取消，失败时保持打开便于修改。 */
export function RenameDialog({ item, onSave, onClose }: RenameDialogProps) {
  const [draft, setDraft] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFolder = item.type === "folder";
  // 首焦点在 effect 里交给输入框，晚于右键菜单卸载时的焦点恢复
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, autoFocus: false });
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 文件只选中主名，便于直接输入而保留扩展名
    const dot = item.name.lastIndexOf(".");
    input.setSelectionRange(0, !isFolder && dot > 0 ? dot : item.name.length);
  }, [item.name, isFolder]);

  // 由后端按真实规则预检（非法字符、保留名、目标已存在等），结果只用于提示
  useEffect(() => {
    if (draft === item.name) {
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renameItems([{ id: item.id, newName: draft }], true)
        .then((report) => {
          if (!cancelled) setError(report.failed[0]?.error ?? null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft, item.id, item.name]);

  const extensionChanged = !isFolder && draft !== item.name && extensionOf(draft) !== extensionOf(item.name);

  const handleClose = () => {
    if (!saving) onClose();
  };
  useEscapeKey(handleClose);

  const handleSave = async () => {
    if (saving || error) return;
    if (draft === item.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch {
      // 失败提示由 useItems.withErrorToast 统一弹出；弹窗保持打开便于修改。
      setSaving(false);
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
        className="modal-surface dialog-panel w-[480px] max-w-[calc(100vw-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-label="重命名"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader title={`重命名「${item.name}」`} onClose={handleClose} disabled={saving} />

        <div className="dialog-body">
          <input
            ref={inputRef}
            aria-label="新名称"
            aria-invalid={error !== null}
            value={draft}
            disabled={saving}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeKeyboardEvent(event)) {
                event.preventDefault();
                void handleSave();
              }
            }}
            className="input-frame w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
          />
          {error ? (
            <p role="alert" className="mt-1.5 text-xs text-[var(--color-danger-ink)]">{error}</p>
          ) : extensionChanged ? (
            <p className="mt-1.5 text-xs text-[var(--text-faint)]">扩展名已修改，类型可能变化</p>
          ) : null}
        </div>

        <div className="dialog-footer justify-end">
          <button type="button" disabled={saving} onClick={handleClose} className="action-button">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || error !== null}
            title="保存（Enter）"
            className="action-button action-button-primary disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

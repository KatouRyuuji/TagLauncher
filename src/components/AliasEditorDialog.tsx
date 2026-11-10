import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ItemWithTags } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isImeKeyboardEvent } from "../lib/itemQuery";
import { ALIAS_MAX_CHARS } from "../lib/itemDisplay";
import { DialogHeader } from "./DialogHeader";

interface AliasEditorDialogProps {
  item: ItemWithTags;
  onSave: (alias: string) => Promise<void>;
  onClose: () => void;
}

/**
 * 显示别名（F07）：只改界面显示与搜索用名，磁盘文件名不变。
 * Enter 保存、Esc 取消；清空后保存即恢复显示磁盘名。
 */
export function AliasEditorDialog({ item, onSave, onClose }: AliasEditorDialogProps) {
  const [draft, setDraft] = useState(item.alias ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, autoFocus: false });
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const length = [...draft.trim()].length;
  const tooLong = length > ALIAS_MAX_CHARS;

  const handleClose = () => {
    if (!saving) onClose();
  };
  useEscapeKey(handleClose);

  const handleSave = async () => {
    if (saving || tooLong) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch {
      // 失败提示由 useItems.withErrorToast 统一弹出；弹窗保持打开便于重试。
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
        className="modal-surface dialog-panel w-[440px] max-w-[calc(100vw-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-label="设置显示别名"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader title="设置显示别名" onClose={handleClose} disabled={saving} />

        <div className="dialog-body space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">
            磁盘名：<span className="break-all font-medium text-[var(--text-primary)]">{item.name}</span>
          </p>
          <input
            ref={inputRef}
            aria-label="显示别名"
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeKeyboardEvent(event)) {
                event.preventDefault();
                void handleSave();
              }
            }}
            placeholder="留空则显示磁盘名"
            className="input-frame h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none"
          />
          <p className={`flex justify-between text-xs ${tooLong ? "text-[var(--color-danger-ink)]" : "text-[var(--text-faint)]"}`}>
            <span>只改界面显示和搜索，不改磁盘文件名（改磁盘名用 F2 重命名）</span>
            <span className="shrink-0 pl-2">{length} / {ALIAS_MAX_CHARS}</span>
          </p>
        </div>

        <div className="dialog-footer justify-end">
          <button type="button" disabled={saving} onClick={handleClose} className="action-button">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || tooLong}
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

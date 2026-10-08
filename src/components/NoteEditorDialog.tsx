import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ItemWithTags } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isImeKeyboardEvent } from "../lib/itemQuery";
import { DialogHeader } from "./DialogHeader";

/** 备注上限（按字符计），与后端 NOTE_MAX_CHARS 一致。 */
export const NOTE_MAX_CHARS = 2000;

interface NoteEditorDialogProps {
  item: ItemWithTags;
  onSave: (note: string) => Promise<void>;
  onClose: () => void;
}

/** 单个对象的备注编辑：Ctrl+Enter 保存，Esc 取消；清空后保存即删除备注。 */
export function NoteEditorDialog({ item, onSave, onClose }: NoteEditorDialogProps) {
  const [draft, setDraft] = useState(item.note ?? "");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 陷阱只负责 Tab 循环与焦点恢复；首焦点在 effect 里交给输入框，
  // 晚于同一提交中右键菜单卸载时的焦点恢复，确保打开即可输入
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, autoFocus: false });
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  const length = [...draft.trim()].length;
  const tooLong = length > NOTE_MAX_CHARS;

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
        className="modal-surface dialog-panel w-[480px] max-w-[calc(100vw-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-label="编辑备注"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader title={`${item.name}的备注`} onClose={handleClose} disabled={saving} />

        <div className="dialog-body">
          <textarea
            ref={textareaRef}
            aria-label="备注内容"
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !isImeKeyboardEvent(event)) {
                event.preventDefault();
                void handleSave();
              }
            }}
            placeholder="写点什么，比如用途、账号提示或待办"
            rows={6}
            className="input-frame w-full resize-y rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-6 text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none"
          />
          <p className={`mt-1.5 text-right text-xs ${tooLong ? "text-[var(--color-danger-ink)]" : "text-[var(--text-faint)]"}`}>
            {length} / {NOTE_MAX_CHARS}
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
            title="保存（Ctrl+Enter）"
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

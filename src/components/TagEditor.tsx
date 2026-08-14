import { useState } from "react";
import { createPortal } from "react-dom";
import { getThemeTagPresetColors } from "../lib/tagColors";
import type { Tag } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isImeKeyboardEvent } from "../lib/itemQuery";
import { showToast } from "../lib/toast";

interface TagEditorProps {
  tag: Tag | null;
  label?: string;
  onSave: (name: string, color: string) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

const COLOR_NAMES = ["蔷薇", "樱粉", "豆沙", "蜜橙", "琥珀", "晴蓝", "藤紫", "莓红"];

export function TagEditor({ tag, label = "标签", onSave, onDelete, onClose }: TagEditorProps) {
  const presetColors = getThemeTagPresetColors();
  const [name, setName] = useState(tag?.name || "");
  const [color, setColor] = useState(tag?.color || presetColors[5] || presetColors[0]);
  const [saving, setSaving] = useState(false);

  useEscapeKey(onClose);
  const contentRef = useFocusTrap<HTMLDivElement>({ active: true });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), color);
    } catch (err) {
      // 保存失败（如重名 UNIQUE 冲突）：明示原因、保留输入与弹窗，便于修正重试；
      // 同时吞掉 rejection，避免 form onSubmit 的 promise 成为未处理拒绝。
      showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // 经 portal 挂到 body：本组件是 fixed 全屏弹层，若渲染在带 backdrop-filter/filter 的
  // 主题区域内（如 sky-cloud 的 sidebar），fixed 会被困在该区域内而非相对视口——
  // 与 ContextMenu 同款处理，免疫任何主题的区域滤镜。
  return createPortal(
    <div
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-panel)" as unknown as number }}
      onClick={onClose}
    >
      <div
        ref={contentRef}
        className="modal-surface w-[420px] max-w-[calc(100vw-2rem)] p-6"
        role="dialog"
        aria-modal="true"
        aria-label="编辑标签"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-label">{label}</div>
            <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
              {tag ? `编辑${label}` : `新建${label}`}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              统一色彩与命名可以让分类结构更清晰。
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5">
          <label className="block">
            <span className="text-label">Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isImeKeyboardEvent(event)) {
                  event.preventDefault();
                }
              }}
              placeholder={`${label}名称`}
              autoFocus
              className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </label>

          <div className="mt-5">
            <div className="text-label">Palette</div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {presetColors.map((preset, index) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-left"
                  style={{
                    borderColor: color === preset ? preset : "var(--border-subtle)",
                    backgroundColor: color === preset
                      ? `color-mix(in srgb, ${preset} 14%, white)`
                      : "color-mix(in srgb, var(--bg-card) 78%, transparent)",
                  }}
                >
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: preset }} />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    {COLOR_NAMES[index] ?? `颜色 ${index + 1}`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="action-button"
                style={{
                  color: "var(--color-danger)",
                  borderColor: "color-mix(in srgb, var(--color-danger) 26%, transparent)",
                  backgroundColor: "var(--color-danger-bg)",
                }}
              >
                删除
              </button>
            )}

            <div className="flex-1" />

            <button type="button" onClick={onClose} className="action-button">
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="action-button action-button-primary disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

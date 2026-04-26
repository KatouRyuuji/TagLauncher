import { useState } from "react";
import { getThemeTagPresetColors } from "../lib/tagColors";
import type { Tag } from "../types";

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), color);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-panel)" as unknown as number }}
      onClick={onClose}
    >
      <div className="modal-surface w-[420px] max-w-[calc(100vw-2rem)] p-6" onClick={(event) => event.stopPropagation()}>
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
    </div>
  );
}

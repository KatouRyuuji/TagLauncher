// ============================================================================
// components/TagEditor.tsx — 标签/文件柜编辑弹窗
// ============================================================================
// 通用编辑弹窗，同时服务于标签和文件柜的新建/编辑/删除。
// 通过 `label` prop 区分显示文字（"标签"或"文件柜"）。
// 通过 `tag` prop 是否为 null 区分新建和编辑模式。
//
// 功能：
// - 名称输入
// - 8 种预设颜色选择（选中时显示白色圆环）
// - 保存/取消/删除按钮
// ============================================================================

import { useState } from "react";
import type { Tag } from "../types";

/** 8 种预设颜色 */
const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
];

interface TagEditorProps {
  tag: Tag | null;                                    // null = 新建模式，非 null = 编辑模式
  label?: string;                                     // 显示文字，默认"标签"
  onSave: (name: string, color: string) => Promise<void>;
  onDelete?: () => void;                              // 编辑模式才有删除按钮
  onClose: () => void;
}

export function TagEditor({ tag, label = "标签", onSave, onDelete, onClose }: TagEditorProps) {
  const [name, setName] = useState(tag?.name || "");
  const [color, setColor] = useState(tag?.color || PRESET_COLORS[5]);  // 默认蓝色
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), color);
    } finally {
      setSaving(false);
    }
  };

  return (
    // 全屏半透明遮罩，点击关闭
    <div className="fixed inset-0 bg-black/68 flex items-center justify-center z-50" onClick={onClose}>
      {/* 弹窗主体，阻止点击事件冒泡到遮罩 */}
      <div className="bg-[var(--bg-elevated)] rounded-[var(--radius-xl)] p-5 w-80 border border-[var(--border-subtle)]" style={{ boxShadow: 'var(--shadow-overlay)' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">
          {tag ? `编辑${label}` : `新建${label}`}
        </h2>
        <form onSubmit={handleSubmit}>
          {/* 名称输入框 */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${label}名称`}
            autoFocus
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none focus:border-[var(--accent-primary)] mb-4"
          />
          {/* 颜色选择器：8 个预设颜色圆点 */}
          <div className="flex gap-2 mb-5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-all ${
                  color === c ? "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-elevated)] scale-110" : "hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {/* 操作按钮 */}
          <div className="flex gap-2">
            {/* 删除按钮（仅编辑模式显示） */}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-1.5 text-sm bg-[var(--color-danger-bg)] hover:bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-[var(--radius-md)] text-[var(--color-danger)] transition-colors"
              >
                删除
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="px-4 py-1.5 text-sm bg-[var(--accent-primary)] hover:opacity-90 disabled:opacity-40 rounded-[var(--radius-md)] text-[var(--text-invert)] transition-colors"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

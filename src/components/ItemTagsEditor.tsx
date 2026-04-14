import { useState } from "react";
import type { ItemWithTags, Tag } from "../types";

interface ItemTagsEditorProps {
  item: ItemWithTags;
  tags: Tag[];
  onSave: (tagIds: number[]) => Promise<void>;
  onAddNewTag: (name: string, baseTagIds: number[]) => Promise<number[]>;
  onClose: () => void;
}

export function ItemTagsEditor({ item, tags, onSave, onAddNewTag, onClose }: ItemTagsEditorProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>(item.tags.map((t) => t.id));
  const [saving, setSaving] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const toggleTag = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selectedIds);
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewTag = async () => {
    const name = newTagName.trim();
    if (!name) return;

    const nextIds = await onAddNewTag(name, selectedIds);
    setSelectedIds(nextIds);
    setNewTagName("");
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: "var(--overlay-bg)" }} onClick={onClose}>
      <div
        className="w-[420px] max-w-[calc(100vw-2rem)] rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
        style={{ boxShadow: 'var(--shadow-overlay)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">管理标签</h2>
          <p className="mt-1 truncate text-xs text-[var(--text-faint)]">{item.name}</p>
        </div>

        <div className="mb-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3">
          <div className="mb-3 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>已选 {selectedIds.length} 个标签</span>
            <span>点击标签切换</span>
          </div>

          {tags.length === 0 ? (
            <p className="py-5 text-center text-sm text-[var(--text-faint)]">暂无标签</p>
          ) : (
            <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto pr-1">
              {tags.map((tag) => {
                const selected = selectedIds.includes(tag.id);

                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-all ${
                      selected
                        ? "border-[var(--border-medium)] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
                    }`}
                    style={{
                      backgroundColor: selected ? `${tag.color}28` : `${tag.color}12`,
                      borderColor: selected ? `${tag.color}66` : undefined,
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-[var(--border-default)]"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                    {selected && <span className="text-[var(--text-secondary)]">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mb-4">
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">新建标签并立即添加到当前项目</p>
          <div className="flex gap-2">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleAddNewTag();
              }
            }}
            placeholder="输入新标签名并回车"
            className="flex-1 bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none focus:border-[var(--accent-primary)]"
          />
          {newTagName.trim() && (
            <button
              type="button"
              onClick={() => {
                void handleAddNewTag();
              }}
              className="px-3 py-1.5 bg-[var(--accent-primary)] hover:opacity-90 rounded-[var(--radius-md)] text-xs text-[var(--text-invert)] transition-colors"
            >
              创建
            </button>
          )}
        </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-[var(--accent-primary)] hover:opacity-90 disabled:opacity-40 rounded-[var(--radius-md)] text-[var(--text-invert)] transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

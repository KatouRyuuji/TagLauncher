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
    <div className="fixed inset-0 bg-black/68 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.08] bg-[#161616] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">管理标签</h2>
          <p className="mt-1 truncate text-xs text-white/30">{item.name}</p>
        </div>

        <div className="mb-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between text-[11px] text-white/38">
            <span>已选 {selectedIds.length} 个标签</span>
            <span>点击标签切换</span>
          </div>

          {tags.length === 0 ? (
            <p className="py-5 text-center text-sm text-white/30">暂无标签</p>
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
                        ? "border-white/[0.16] text-white shadow-[0_6px_16px_rgba(0,0,0,0.22)]"
                        : "border-white/[0.06] text-white/72 hover:border-white/[0.14] hover:text-white"
                    }`}
                    style={{
                      backgroundColor: selected ? `${tag.color}28` : `${tag.color}12`,
                      borderColor: selected ? `${tag.color}66` : undefined,
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                    {selected && <span className="text-white/70">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mb-4">
          <p className="mb-2 text-[11px] text-white/38">新建标签并立即添加到当前项目</p>
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
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
          />
          {newTagName.trim() && (
            <button
              type="button"
              onClick={() => {
                void handleAddNewTag();
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs text-white transition-colors"
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
            className="px-3 py-1.5 text-sm bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-lg text-white/60 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-white transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

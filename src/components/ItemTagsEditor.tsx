import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ItemWithTags, Tag } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isImeKeyboardEvent } from "../lib/itemQuery";
import { showToast } from "../lib/toast";

interface ItemTagsEditorProps {
  item: ItemWithTags;
  tags: Tag[];
  onSave: (tagIds: number[]) => Promise<void>;
  onAddNewTag: (name: string, baseTagIds: number[]) => Promise<number[]>;
  /** 取消时回收本次会话新建但未落库的空标签 */
  onRecycleNewTags?: (tagIds: number[]) => Promise<void>;
  onClose: () => void;
}

export function ItemTagsEditor({ item, tags, onSave, onAddNewTag, onRecycleNewTags, onClose }: ItemTagsEditorProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>(item.tags.map((tag) => tag.id));
  const [saving, setSaving] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  // 跟踪本次会话中通过 quick-create 真正新建的标签 id（复用同名已有标签不计入）：
  // 进入编辑器时快照已有 id，之后 diff 出的新 id 即为新建。
  const knownTagIdsRef = useRef<Set<number>>(new Set(tags.map((t) => t.id)));
  const createdTagIdsRef = useRef<number[]>([]);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true });

  useEffect(() => {
    for (const tag of tags) {
      if (!knownTagIdsRef.current.has(tag.id)) {
        knownTagIdsRef.current.add(tag.id);
        createdTagIdsRef.current.push(tag.id);
      }
    }
  }, [tags]);

  // 取消/关闭：回收本次新建且未保存的空标签，避免"点取消却已写入 DB"的残留
  const handleClose = () => {
    if (createdTagIdsRef.current.length > 0) {
      void onRecycleNewTags?.(createdTagIdsRef.current);
      createdTagIdsRef.current = [];
    }
    onClose();
  };

  useEscapeKey(handleClose);

  const toggleTag = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 以原 item.tags 顺序为基准重建：保留原有顺序、剔除被取消项、新增项追加末尾，
      // 避免"取消再重选"把标签挪到末尾打乱展示顺序。
      const selectedSet = new Set(selectedIds);
      const originalIds = item.tags.map((tag) => tag.id);
      const kept = originalIds.filter((id) => selectedSet.has(id));
      const keptSet = new Set(kept);
      const added = selectedIds.filter((id) => !keptSet.has(id));
      await onSave([...kept, ...added]);
      // 保存成功：新建标签已随保存落库，清空回收清单
      createdTagIdsRef.current = [];
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewTag = async () => {
    const name = newTagName.trim();
    if (!name) return;

    try {
      const nextIds = await onAddNewTag(name, selectedIds);
      setSelectedIds(nextIds);
      setNewTagName("");
    } catch (err) {
      // 失败时保留输入便于修正重试（此前是静默的未处理 rejection）
      showToast(`新建标签失败：${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  return createPortal(
    <div
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-panel)" as unknown as number }}
      onClick={handleClose}
    >
      <div
        ref={trapRef}
        className="modal-surface w-[520px] max-w-[calc(100vw-2rem)] p-6"
        role="dialog"
        aria-modal="true"
        aria-label="管理项目标签"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-label">Tags</div>
            <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">管理项目标签</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{item.name}</p>
          </div>
          <button type="button" onClick={handleClose} className="icon-button">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="surface-card-soft mt-5 p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>已选 {selectedIds.length} 个标签</span>
            <span>点击即可切换状态</span>
          </div>

          {tags.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">当前还没有可用标签</p>
          ) : (
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
              {tags.map((tag) => {
                const selected = selectedIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-full)] border px-3 py-2 text-xs font-medium"
                    style={{
                      backgroundColor: selected
                        ? `color-mix(in srgb, ${tag.color} var(--tag-selected-alpha), var(--bg-card))`
                        : `color-mix(in srgb, ${tag.color} var(--tag-muted-alpha), var(--bg-card))`,
                      borderColor: selected
                        ? `color-mix(in srgb, ${tag.color} var(--tag-selected-border-alpha), transparent)`
                        : `color-mix(in srgb, ${tag.color} 26%, transparent)`,
                      color: tag.color,
                    }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span>{tag.name}</span>
                    {selected && <span className="text-[10px]">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="surface-card-soft mt-4 p-4">
          <div className="text-label">Quick Create</div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">新建标签并立即加入当前项目</p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (isImeKeyboardEvent(event)) return;
                event.preventDefault();
                void handleAddNewTag();
              }}
              placeholder="输入新标签名"
              className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none"
            />

            <button
              type="button"
              onClick={() => void handleAddNewTag()}
              disabled={!newTagName.trim()}
              className="action-button action-button-primary disabled:opacity-40"
            >
              创建
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={handleClose} className="action-button">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="action-button action-button-primary disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

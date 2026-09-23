import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ItemWithTags, Tag } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useImeComposition } from "../hooks/useImeComposition";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isImeKeyboardEvent, compareNames } from "../lib/itemQuery";
import { tagFilterPlaceholder } from "../lib/itemActionCopy";
import { showToast } from "../lib/toast";
import { DialogHeader } from "./DialogHeader";
import { flattenTagTree, type TagTreeRow } from "../lib/tagTree";
import { useAppStore } from "../stores/appStore";

// 标签数超过阈值才显示过滤框（与 BatchSelectionToolbar 的 TAG_MENU_FILTER_THRESHOLD 对齐）
const TAG_FILTER_THRESHOLD = 8;

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
  const tagRelations = useAppStore((state) => state.tagRelations);
  const [selectedIds, setSelectedIds] = useState<number[]>(item.tags.map((tag) => tag.id));
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  // IME 组合中只更新文本，组合结束才过滤（appliedTagFilter）
  const [appliedTagFilter, setAppliedTagFilter] = useState("");
  const tagFilterIme = useImeComposition<string>(setAppliedTagFilter);
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
    if (saving || creating) return;
    if (createdTagIdsRef.current.length > 0) {
      void onRecycleNewTags?.(createdTagIdsRef.current);
      createdTagIdsRef.current = [];
    }
    onClose();
  };

  // Esc 两级：过滤词非空先清词（再按才关弹窗），空时关闭
  useEscapeKey(() => {
    if (tagFilter) {
      setTagFilter("");
      setAppliedTagFilter("");
      return;
    }
    handleClose();
  }, !saving && !creating);

  const toggleTag = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (saving || creating) return;
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
    } catch {
      // 失败提示已由 onSave 链路（useItems.withErrorToast）统一弹出，
      // 这里只吞掉 rejection，避免未处理拒绝噪音；弹窗保持打开便于重试。
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewTag = async () => {
    const name = newTagName.trim();
    if (!name || saving || creating) return;

    setCreating(true);
    try {
      const nextIds = await onAddNewTag(name, selectedIds);
      setSelectedIds(nextIds);
      setNewTagName("");
    } catch (err) {
      // 失败时保留输入便于修正重试（此前是静默的未处理 rejection）
      showToast(`新建标签失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setCreating(false);
    }
  };

  // 标签按侧栏的父子关系呈现，名称和层级是识别主线；过滤时保留原层级。
  const tagQuery = appliedTagFilter.trim().toLowerCase();
  const tagRows = flattenTagTree(tags, tagRelations, (a, b) => compareNames(a.name, b.name));
  const visibleTagRows = tagQuery
    ? tagRows.filter(({ tag }) => tag.name.toLowerCase().includes(tagQuery))
    : tagRows;
  const selectedTags = selectedIds.map((id) => tags.find((tag) => tag.id === id)).filter((tag): tag is Tag => tag !== undefined);
  const showTagFilter = tags.length > TAG_FILTER_THRESHOLD;

  const renderTagButton = ({ tag, depth }: TagTreeRow<Tag>) => {
    const selected = selectedIds.includes(tag.id);
    return (
      <button
        key={tag.id}
        type="button"
        onClick={() => toggleTag(tag.id)}
        disabled={saving || creating}
        aria-pressed={selected}
        aria-label={tag.name}
        className={`flex min-h-9 w-full items-center gap-2.5 rounded-[var(--radius-sm)] pr-3 text-left text-[13px] transition-colors ${selected
          ? "bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
        style={{
          paddingLeft: `${12 + depth * 18}px`,
        }}
      >
        <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${selected ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--text-invert)]" : "border-[var(--border-strong)]"}`}>
          {selected && <Check size={11} strokeWidth={2.5} />}
        </span>
        <span className="tag-pill min-w-0 truncate px-2 py-0.5" style={{ "--tag-color": tag.color } as CSSProperties}>{tag.name}</span>
      </button>
    );
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
        aria-label="管理项目标签"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader title={`${item.name}的标签`} onClose={handleClose} disabled={saving || creating} />

        <div className="dialog-body">
        <section aria-label="已有标签">
          {/* 过滤框模式同批量工具条 TagOwnershipMenu；不挂 autoFocus：会话内新建标签使数量
              跨过阈值时输入框才挂载，自动聚焦会打断正在输入的新建流程 */}
          {showTagFilter && (
            <input
              type="search"
              aria-label={tagFilterPlaceholder}
              placeholder={tagFilterPlaceholder}
              disabled={saving || creating}
              value={tagFilter}
              onChange={(event) => { setTagFilter(event.target.value); tagFilterIme.onChange(event.target.value); }}
              onCompositionStart={tagFilterIme.onCompositionStart}
              onCompositionEnd={tagFilterIme.onCompositionEnd}
              className="mb-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)]"
            />
          )}
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>已选 {selectedIds.length} 个标签</span>
            <span>按层级浏览</span>
          </div>
          {selectedIds.length > 0 && (
            <div className="mb-4 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="已选标签">
              {selectedTags.map((tag) => (
                <button key={tag.id} type="button" className="tag-pill gap-1.5 px-2 py-1 text-[12px]" style={{ "--tag-color": tag.color } as CSSProperties}
                  disabled={saving || creating} onClick={() => toggleTag(tag.id)} aria-label={`移除已选标签「${tag.name}」`}>
                  {tag.name}<X size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          {tags.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">当前还没有可用标签</p>
          ) : visibleTagRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">无匹配标签</p>
          ) : (
            <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1" role="group" aria-label="按层级排列的标签">
              {visibleTagRows.map(renderTagButton)}
            </div>
          )}
        </section>

        <section className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-label="新建标签">
          <h3 className="sr-only">新建标签</h3>
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="新标签名称"
              disabled={saving || creating}
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (isImeKeyboardEvent(event)) return;
                event.preventDefault();
                void handleAddNewTag();
              }}
              placeholder="输入新标签名"
              className="input-frame min-h-10 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none"
            />

            <button
              type="button"
              onClick={() => void handleAddNewTag()}
              disabled={!newTagName.trim() || saving || creating}
              className="action-button action-button-primary disabled:opacity-60"
            >
              {creating ? "创建中…" : "创建"}
            </button>
          </div>
        </section>
        </div>

        <div className="dialog-footer justify-end">
          <button type="button" disabled={saving || creating} onClick={handleClose} className="action-button">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || creating}
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

import { useMemo, useState } from "react";
import type { Tag, ItemWithTags } from "../types";
import { useAppStore } from "../stores/appStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ItemVisualIcon } from "./ItemVisualIcon";
import { buildDescendantsMap } from "../lib/tagGraph";

interface TagRelationsEditorProps {
  tags: Tag[];
  allItems: ItemWithTags[];
  onAddRelation: (parentId: number, childId: number) => Promise<void>;
  onRemoveRelation: (parentId: number, childId: number) => Promise<void>;
  onClose: () => void;
}

/**
 * 标签关系编辑器：为每个标签维护父标签（多继承），并预览该标签关联的对象。
 * 父标签是子标签的超集；筛选时选中父标签会并入其所有后代对象。后端拒绝成环关系。
 */
export function TagRelationsEditor({ tags, allItems, onAddRelation, onRemoveRelation, onClose }: TagRelationsEditorProps) {
  const relations = useAppStore((s) => s.tagRelations);
  const [focusedId, setFocusedId] = useState<number | null>(tags[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeKey(onClose);

  const tagById = new Map(tags.map((t) => [t.id, t]));
  const focused = focusedId == null ? null : tagById.get(focusedId) ?? null;

  const parentIds = focused
    ? relations.filter((r) => r.childId === focused.id).map((r) => r.parentId)
    : [];
  const parentSet = new Set(parentIds);
  const childCount = focused
    ? relations.filter((r) => r.parentId === focused.id).length
    : 0;

  // 候选父标签：排除自身、已是父级的、以及会形成环的（focused 的后代不能再做其父）。
  // 主动过滤而非事后报错，避免用户做无效操作。
  const descendantsMap = useMemo(() => buildDescendantsMap(relations), [relations]);
  const focusedDescendants = focused
    ? descendantsMap.get(focused.id) ?? new Set<number>([focused.id])
    : new Set<number>();
  const candidates = focused
    ? tags.filter(
        (t) => t.id !== focused.id && !parentSet.has(t.id) && !focusedDescendants.has(t.id),
      )
    : [];

  // 当前标签关联的对象（直接打了该标签的对象）
  const focusedItems = useMemo(
    () => (focused ? allItems.filter((it) => it.tags.some((t) => t.id === focused.id)) : []),
    [focused, allItems],
  );

  const runMutation = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-panel)" as unknown as number }}
      onClick={onClose}
    >
      <div
        className="modal-surface w-[560px] max-w-[calc(100vw-2rem)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-label">标签关系</div>
            <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">管理父子层级</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              父标签是子标签的超集——筛选父标签会并入其所有后代对象。一个标签可有多个父（图状，非树状）。
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {tags.length === 0 ? (
          <div className="surface-card-soft mt-5 px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            暂无标签，先创建标签后再来建立层级关系。
          </div>
        ) : (
          <>
            {/* 选择当前标签 */}
            <div className="mt-5">
              <div className="text-label">选择标签</div>
              <div className="mt-2 flex max-h-[140px] flex-wrap gap-2 overflow-y-auto">
                {tags.map((tag) => {
                  const active = tag.id === focusedId;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => { setFocusedId(tag.id); setError(null); }}
                      className="flex items-center gap-2 rounded-[var(--radius-full)] border px-3 py-1.5 text-sm"
                      style={{
                        borderColor: active
                          ? tag.color
                          : "var(--border-subtle)",
                        backgroundColor: active
                          ? `color-mix(in srgb, ${tag.color} 16%, var(--bg-card))`
                          : "color-mix(in srgb, var(--bg-card) 82%, transparent)",
                        color: active ? tag.color : "var(--text-secondary)",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                      <span className="max-w-[140px] truncate">{tag.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {focused && (
              <>
              <div className="mt-5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_70%,transparent)] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: focused.color }} />
                  <span className="truncate">{focused.name}</span>
                  <span className="text-xs font-normal text-[var(--text-faint)]">
                    {parentIds.length} 个父 · {childCount} 个子
                  </span>
                </div>

                {/* 当前父标签 */}
                <div className="mt-3">
                  <div className="text-label">父标签（点击移除）</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {parentIds.length === 0 ? (
                      <span className="text-xs text-[var(--text-faint)]">暂无父标签（此标签为顶层集合）</span>
                    ) : (
                      parentIds.map((pid) => {
                        const p = tagById.get(pid);
                        if (!p) return null;
                        return (
                          <button
                            key={pid}
                            type="button"
                            disabled={busy}
                            onClick={() => runMutation(() => onRemoveRelation(pid, focused.id))}
                            className="group flex items-center gap-1.5 rounded-[var(--radius-full)] border px-2.5 py-1 text-xs disabled:opacity-50"
                            style={{
                              borderColor: `color-mix(in srgb, ${p.color} 40%, transparent)`,
                              backgroundColor: `color-mix(in srgb, ${p.color} 16%, var(--bg-elevated))`,
                              color: p.color,
                            }}
                            title="点击移除该父标签"
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                            <span className="max-w-[120px] truncate">{p.name}</span>
                            <svg className="h-3 w-3 opacity-60 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
                            </svg>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 添加父标签 */}
                <div className="mt-4">
                  <div className="text-label">添加父标签</div>
                  <div className="mt-2 flex max-h-[120px] flex-wrap gap-2 overflow-y-auto">
                    {candidates.length === 0 ? (
                      <span className="text-xs text-[var(--text-faint)]">没有可添加的父标签</span>
                    ) : (
                      candidates.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={busy}
                          onClick={() => runMutation(() => onAddRelation(c.id, focused.id))}
                          className="flex items-center gap-1.5 rounded-[var(--radius-full)] border border-dashed border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-50"
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                          <span className="max-w-[120px] truncate">{c.name}</span>
                          <span className="text-[var(--text-faint)]">＋</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {error && (
                  <div className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger)]">
                    {error}
                  </div>
                )}
              </div>

              {/* 该标签关联的对象（图标 + 名称） */}
              <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_70%,transparent)] p-4">
                <div className="text-label">关联对象 · {focusedItems.length}</div>
                {focusedItems.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--text-faint)]">还没有对象打上此标签</p>
                ) : (
                  <div className="mt-2 grid max-h-[180px] grid-cols-2 gap-2 overflow-y-auto">
                    {focusedItems.slice(0, 30).map((it) => (
                      <div
                        key={it.id}
                        className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1.5"
                        title={it.name}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[15px]">
                          <ItemVisualIcon item={it} emojiClass="leading-none" imageClass="h-full w-full object-cover" />
                        </div>
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">{it.name}</span>
                      </div>
                    ))}
                    {focusedItems.length > 30 && (
                      <div className="col-span-2 px-1 py-1 text-center text-xs text-[var(--text-faint)]">
                        还有 {focusedItems.length - 30} 个…
                      </div>
                    )}
                  </div>
                )}
              </div>
              </>
            )}
          </>
        )}

        <div className="mt-6 flex items-center justify-end">
          <button type="button" onClick={onClose} className="action-button action-button-primary">
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

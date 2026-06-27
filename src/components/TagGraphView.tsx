import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { computeLayers } from "../lib/tagGraph";
import { ItemVisualIcon } from "./ItemVisualIcon";
import type { ItemWithTags } from "../types";

interface NodePos {
  cx: number;
  top: number;
  bottom: number;
}

interface TagGraphViewProps {
  allItems: ItemWithTags[];
}

/**
 * 独立标签关系图视图（探索式）。
 * 左侧把标签 DAG 按层级自上而下分层绘制（节点=标签，边=父→子，节点带对象数量徽标）；
 * 点击节点在右侧面板展示该标签关联的对象（图标+名称）与父子关系，并可一键筛选。
 * 纯 SVG/CSS，零额外依赖，保持轻量。
 */
export function TagGraphView({ allItems }: TagGraphViewProps) {
  const tags = useAppStore((s) => s.tags);
  const relations = useAppStore((s) => s.tagRelations);
  const toggleTagSelection = useAppStore((s) => s.toggleTagSelection);
  const setTagGraphOpen = useAppStore((s) => s.setTagGraphOpen);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  useEscapeKey(() => setTagGraphOpen(false));

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  // 每个标签直接关联的对象
  const itemsByTag = useMemo(() => {
    const map = new Map<number, ItemWithTags[]>();
    for (const item of allItems) {
      for (const tag of item.tags) {
        const arr = map.get(tag.id);
        if (arr) arr.push(item);
        else map.set(tag.id, [item]);
      }
    }
    return map;
  }, [allItems]);

  // 仅保留端点存在的关系边
  const validRelations = useMemo(() => {
    const ids = new Set(tags.map((t) => t.id));
    return relations.filter((r) => ids.has(r.parentId) && ids.has(r.childId));
  }, [tags, relations]);

  // 按层级分组（层内按名称排序）
  const layers = useMemo(() => {
    const layerOf = computeLayers(tags.map((t) => t.id), validRelations);
    const byLayer = new Map<number, typeof tags>();
    for (const tag of tags) {
      const l = layerOf.get(tag.id) ?? 0;
      const arr = byLayer.get(l);
      if (arr) arr.push(tag);
      else byLayer.set(l, [tag]);
    }
    return Array.from(byLayer.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, list]) => ({
        level,
        tags: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [tags, validRelations]);

  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [positions, setPositions] = useState<Map<number, NodePos>>(new Map());

  const measure = () => {
    const content = contentRef.current;
    if (!content) return;
    const base = content.getBoundingClientRect();
    const next = new Map<number, NodePos>();
    for (const [id, el] of nodeRefs.current) {
      const r = el.getBoundingClientRect();
      next.set(id, {
        cx: r.left - base.left + r.width / 2,
        top: r.top - base.top,
        bottom: r.top - base.top + r.height,
      });
    }
    setPositions(next);
  };

  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, validRelations, selectedNodeId]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const selectedTag = selectedNodeId == null ? null : tagById.get(selectedNodeId) ?? null;
  const selectedItems = selectedNodeId == null ? [] : itemsByTag.get(selectedNodeId) ?? [];
  const selectedParents = selectedNodeId == null
    ? []
    : validRelations.filter((r) => r.childId === selectedNodeId).map((r) => tagById.get(r.parentId)).filter(Boolean);
  const selectedChildren = selectedNodeId == null
    ? []
    : validRelations.filter((r) => r.parentId === selectedNodeId).map((r) => tagById.get(r.childId)).filter(Boolean);

  const applyFilter = (tagId: number) => {
    toggleTagSelection(tagId);
    setTagGraphOpen(false);
  };

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-panel)" as unknown as number }}
    >
      <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden modal-surface">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-4">
          <div>
            <div className="text-label">标签关系图</div>
            <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">层级图谱</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              自上而下按层级展示标签父子关系（图状，可多继承）。点击标签查看其关联对象，再决定是否筛选。
            </p>
          </div>
          <button type="button" onClick={() => setTagGraphOpen(false)} className="icon-button" title="关闭 (Esc)">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左：层级图谱 */}
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-8 py-8">
            {tags.length === 0 ? (
              <div className="surface-card-soft px-6 py-10 text-center text-sm text-[var(--text-muted)]">
                暂无标签。创建标签并在「标签关系」中建立父子层级后，这里会显示图谱。
              </div>
            ) : (
              <div ref={contentRef} className="relative inline-block min-w-full">
                {/* 连线层 */}
                <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
                  <defs>
                    <marker id="tl-graph-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--border-default)" />
                    </marker>
                  </defs>
                  {validRelations.map((rel, i) => {
                    const p = positions.get(rel.parentId);
                    const c = positions.get(rel.childId);
                    if (!p || !c) return null;
                    const x1 = p.cx;
                    const y1 = p.bottom;
                    const x2 = c.cx;
                    const y2 = c.top;
                    const midY = (y1 + y2) / 2;
                    const active = selectedNodeId === rel.parentId || selectedNodeId === rel.childId;
                    return (
                      <path
                        key={i}
                        d={`M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
                        fill="none"
                        stroke={active ? "var(--accent-primary)" : "var(--border-default)"}
                        strokeWidth={active ? 2 : 1.5}
                        markerEnd="url(#tl-graph-arrow)"
                      />
                    );
                  })}
                </svg>

                {/* 分层节点 */}
                <div className="relative flex flex-col gap-12">
                  {layers.map(({ level, tags: layerTags }) => (
                    <div key={level} className="flex items-center gap-5">
                      <div className="w-16 shrink-0 text-right text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                        Level {level}
                      </div>
                      <div className="flex flex-wrap gap-5">
                        {layerTags.map((tag) => {
                          const active = selectedNodeId === tag.id;
                          const count = itemsByTag.get(tag.id)?.length ?? 0;
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              ref={(el) => {
                                if (el) nodeRefs.current.set(tag.id, el);
                                else nodeRefs.current.delete(tag.id);
                              }}
                              onClick={() => setSelectedNodeId(tag.id)}
                              onDoubleClick={() => applyFilter(tag.id)}
                              className="relative flex items-center gap-2 rounded-[var(--radius-md)] border px-4 py-2.5 text-sm shadow-[var(--shadow-card)]"
                              style={{
                                borderColor: active
                                  ? tag.color
                                  : `color-mix(in srgb, ${tag.color} 36%, var(--border-subtle))`,
                                backgroundColor: active
                                  ? `color-mix(in srgb, ${tag.color} 20%, var(--bg-card))`
                                  : "var(--bg-card)",
                                color: active ? tag.color : "var(--text-primary)",
                                fontWeight: active ? 600 : 500,
                              }}
                              title={`${tag.name}（${count} 个对象）双击直接筛选`}
                            >
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                              <span className="max-w-[180px] truncate">{tag.name}</span>
                              <span
                                className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-full)] px-1.5 text-[11px] font-semibold"
                                style={{
                                  backgroundColor: `color-mix(in srgb, ${tag.color} 18%, var(--bg-elevated))`,
                                  color: tag.color,
                                }}
                              >
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右：选中标签的对象面板 */}
          {selectedTag && (
            <div className="flex w-80 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_60%,transparent)]">
              <div className="border-b border-[var(--border-subtle)] px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: selectedTag.color }} />
                  <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-primary)]">{selectedTag.name}</h3>
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(null)}
                    className="icon-button h-7 w-7"
                    title="收起"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
                {(selectedParents.length > 0 || selectedChildren.length > 0) && (
                  <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                    {selectedParents.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[var(--text-faint)]">父：</span>
                        {selectedParents.map((p) => (
                          <button
                            key={p!.id}
                            type="button"
                            onClick={() => setSelectedNodeId(p!.id)}
                            className="rounded-[var(--radius-full)] px-1.5 py-0.5"
                            style={{ backgroundColor: `color-mix(in srgb, ${p!.color} 16%, transparent)`, color: p!.color }}
                          >
                            {p!.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedChildren.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[var(--text-faint)]">子：</span>
                        {selectedChildren.map((c) => (
                          <button
                            key={c!.id}
                            type="button"
                            onClick={() => setSelectedNodeId(c!.id)}
                            className="rounded-[var(--radius-full)] px-1.5 py-0.5"
                            style={{ backgroundColor: `color-mix(in srgb, ${c!.color} 16%, transparent)`, color: c!.color }}
                          >
                            {c!.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <div className="px-2 pb-2 text-label">关联对象 · {selectedItems.length}</div>
                {selectedItems.length === 0 ? (
                  <p className="px-2 text-xs text-[var(--text-faint)]">还没有对象打上此标签</p>
                ) : (
                  <div className="space-y-1">
                    {selectedItems.map((it) => (
                      <div
                        key={it.id}
                        className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                        title={it.path}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[17px]">
                          <ItemVisualIcon item={it} emojiClass="leading-none" imageClass="h-full w-full object-cover" />
                        </div>
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{it.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--border-subtle)] px-5 py-3">
                <button
                  type="button"
                  onClick={() => applyFilter(selectedTag.id)}
                  className="action-button action-button-primary w-full justify-center"
                >
                  筛选此标签
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

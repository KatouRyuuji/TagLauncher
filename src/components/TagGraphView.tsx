import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAppStore } from "../stores/appStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { computeLayers, orderLayersByBarycenter, pickDefaultGraphNode, resolveTagGraphEmptyState } from "../lib/tagGraph";
import { compareNames } from "../lib/itemQuery";
import { ItemVisualIcon } from "./ItemVisualIcon";
import { DialogHeader } from "./DialogHeader";
import type { ItemWithTags } from "../types";

/** 右侧关联对象列表每页展示数量（点击"显示更多"递增） */
const RIGHT_PANEL_PAGE_SIZE = 50;

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
  const setSelectedTagIds = useAppStore((s) => s.setSelectedTagIds);
  const setTagGraphOpen = useAppStore((s) => s.setTagGraphOpen);
  // SVG marker id 实例唯一化：多实例共存（未来弹窗+预览）时硬编码 id 会互相覆盖
  const arrowMarkerId = useId();

  // 初值在首次渲染用 store 里已有的关系挑选；若当时还没有边，后面用 effect 补选。
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(() => {
    const ids = tags.map((t) => t.id);
    const allowed = new Set(ids);
    return pickDefaultGraphNode(
      ids,
      relations.filter((r) => allowed.has(r.parentId) && allowed.has(r.childId)),
    );
  });
  // 用户点空白 / 再点同一节点 / 收起详情 主动取消后，不再自动补选。
  const userClearedSelectionRef = useRef(false);
  // 右侧关联对象列表分页：热门标签可能关联数千对象，避免一次性全量渲染卡顿。
  const [visibleCount, setVisibleCount] = useState(RIGHT_PANEL_PAGE_SIZE);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true });

  useEscapeKey(() => setTagGraphOpen(false));

  // 切换选中标签时重置分页
  useEffect(() => {
    setVisibleCount(RIGHT_PANEL_PAGE_SIZE);
  }, [selectedNodeId]);

  // 标签按名称排序作为层内默认顺序，再经 barycenter 优化减少边交叉。
  const sortedTags = useMemo(() => [...tags].sort((a, b) => compareNames(a.name, b.name)), [tags]);
  const tagById = useMemo(() => new Map(sortedTags.map((t) => [t.id, t])), [sortedTags]);

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
    const ids = new Set(sortedTags.map((t) => t.id));
    return relations.filter((r) => ids.has(r.parentId) && ids.has(r.childId));
  }, [sortedTags, relations]);

  // 空态语义：无标签（图无从谈起）与无关系（节点可画但没有层级）分开引导
  const emptyState = resolveTagGraphEmptyState(tags.length, validRelations.length);

  // 关系晚到时补选一次；手动取消后不再抢回选中。
  useEffect(() => {
    if (selectedNodeId !== null || userClearedSelectionRef.current) return;
    const picked = pickDefaultGraphNode(sortedTags.map((t) => t.id), validRelations);
    if (picked != null) setSelectedNodeId(picked);
  }, [selectedNodeId, validRelations, sortedTags]);

  // 按层级分组，层内用 barycenter 排序减少连线交叉
  const layers = useMemo(() => {
    const layerOf = computeLayers(sortedTags.map((t) => t.id), validRelations);
    const byLayer = new Map<number, number[]>();
    for (const tag of sortedTags) {
      const l = layerOf.get(tag.id) ?? 0;
      const arr = byLayer.get(l);
      if (arr) arr.push(tag.id);
      else byLayer.set(l, [tag.id]);
    }
    const levelKeys = Array.from(byLayer.keys()).sort((a, b) => a - b);
    const layerIds = levelKeys.map((level) => byLayer.get(level)!);
    const orderedIds = orderLayersByBarycenter(layerIds, validRelations, 3);
    return orderedIds.map((ids, index) => ({
      level: levelKeys[index],
      tags: ids.map((id) => tagById.get(id)).filter((t): t is NonNullable<typeof t> => t != null),
    }));
  }, [sortedTags, validRelations, tagById]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [positions, setPositions] = useState<Map<number, NodePos>>(new Map());

  const measure = useCallback(() => {
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
    setPositions((current) => {
      if (current.size === next.size && [...next].every(([id, position]) => {
        const previous = current.get(id);
        return previous?.cx === position.cx && previous.top === position.top && previous.bottom === position.bottom;
      })) return current;
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const content = contentRef.current;
    const canvas = canvasRef.current;
    if (typeof ResizeObserver === "undefined") return;
    let frame: number | null = null;
    const ro = new ResizeObserver(() => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; measure(); });
    });
    if (content) ro.observe(content);
    if (canvas) ro.observe(canvas);
    for (const node of nodeRefs.current.values()) ro.observe(node);
    return () => {
      ro.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [layers, measure]);

  const relatedNodeIds = useMemo(() => {
    if (selectedNodeId == null) return null;
    const ids = new Set<number>([selectedNodeId]);
    for (const rel of validRelations) {
      if (rel.parentId === selectedNodeId) ids.add(rel.childId);
      if (rel.childId === selectedNodeId) ids.add(rel.parentId);
    }
    return ids;
  }, [selectedNodeId, validRelations]);

  const clearSelection = useCallback(() => {
    userClearedSelectionRef.current = true;
    setSelectedNodeId(null);
  }, []);

  const selectNode = useCallback((tagId: number) => {
    setSelectedNodeId((current) => {
      if (current === tagId) {
        userClearedSelectionRef.current = true;
        return null;
      }
      userClearedSelectionRef.current = false;
      return tagId;
    });
  }, []);

  const handleCanvasBackgroundClick = useCallback((event: { target: EventTarget | null }) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-graph-node-id]")) return;
    if (selectedNodeId == null) return;
    clearSelection();
  }, [clearSelection, selectedNodeId]);

  const selectedTag = selectedNodeId == null ? null : tagById.get(selectedNodeId) ?? null;
  const selectedItems = selectedNodeId == null ? [] : itemsByTag.get(selectedNodeId) ?? [];
  const selectedParents = selectedNodeId == null
    ? []
    : validRelations.filter((r) => r.childId === selectedNodeId).map((r) => tagById.get(r.parentId)).filter((t): t is NonNullable<typeof t> => t != null);
  const selectedChildren = selectedNodeId == null
    ? []
    : validRelations.filter((r) => r.parentId === selectedNodeId).map((r) => tagById.get(r.childId)).filter((t): t is NonNullable<typeof t> => t != null);

  const applyFilter = (tagId: number) => {
    // 双击=明确筛选意图：强制选中该标签。不能用 toggleTagSelection——
    // 若该标签已在筛选中，toggle 会变成取消筛选，与双击意图相反。
    setSelectedTagIds([tagId]);
    setTagGraphOpen(false);
  };

  return (
    <div
      ref={trapRef}
      data-workspace-overlay=""
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height)] flex flex-col"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-panel)" }}
      role="dialog"
      aria-modal="true"
      aria-label="标签关系图"
    >
      <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden modal-surface">
        <DialogHeader title="层级图谱" description="点击标签查看关系和关联对象，双击标签直接筛选。" onClose={() => setTagGraphOpen(false)} />

        <div className="relative flex min-h-0 flex-1">
          {/* 左：层级图谱 */}
          <div
            ref={canvasRef}
            data-region="tag-graph-canvas"
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--bg-base)] px-5 py-6 sm:px-8 sm:py-8"
            onClick={handleCanvasBackgroundClick}
          >
            {emptyState === "no-tags" ? (
              <div className="flex h-full items-center justify-center">
                <div className="surface-card-soft flex max-w-[420px] flex-col items-center px-8 py-12 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-6 11a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm12 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 8.5v3m0 0-4.5 3.6M12 11.5l4.5 3.6" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">还没有标签</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                    图谱以标签为节点、父子关系为连线。先在侧栏创建标签，再回来建立层级。
                  </p>
                  <button
                    type="button"
                    onClick={() => setTagGraphOpen(false)}
                    className="action-button action-button-primary mt-5"
                  >
                    返回工作台创建标签
                  </button>
                </div>
              </div>
            ) : (
              <div ref={contentRef} className="relative w-full min-w-0 pr-10 pb-6">
                {selectedNodeId == null && emptyState !== "no-relations" && (
                  <p className="mb-4 text-sm text-[var(--text-faint)]">点选一个标签查看它的父子连线。</p>
                )}
                {emptyState === "no-relations" && (
                  <div className="mb-6 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--accent-primary)_28%,transparent)] bg-[var(--accent-primary-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                    </svg>
                    <span>
                      尚未建立任何父子关系，所有标签都在同一层。到侧栏「标签关系」为标签设置父级后，这里会呈现层级连线。
                    </span>
                  </div>
                )}
                {/* 连线层 */}
                <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
                  <defs>
                    <marker id={arrowMarkerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--border-strong)" />
                    </marker>
                    <marker id={`${arrowMarkerId}-active`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent-primary)" />
                    </marker>
                  </defs>
                  {(selectedNodeId == null
                    ? []
                    : validRelations.filter((rel) => rel.parentId === selectedNodeId || rel.childId === selectedNodeId)
                  ).map((rel) => {
                    const p = positions.get(rel.parentId);
                    const c = positions.get(rel.childId);
                    if (!p || !c) return null;
                    const x1 = p.cx;
                    const y1 = p.bottom;
                    const x2 = c.cx;
                    const y2 = c.top;
                    const midY = (y1 + y2) / 2;
                    const active = true;
                    return (
                      <path
                        key={`${rel.parentId}-${rel.childId}`}
                        d={`M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
                        fill="none"
                        stroke={active ? "var(--accent-primary)" : "var(--border-strong)"}
                        strokeWidth={active ? 2 : 1.5}
                        markerEnd={`url(#${arrowMarkerId}${active ? "-active" : ""})`}
                      />
                    );
                  })}
                </svg>

                {/* 分层节点 */}
                <div className="relative flex w-full min-w-0 flex-col gap-16">
                  {layers.map(({ level, tags: layerTags }) => (
                    <div key={level} className="flex w-full items-start gap-6">
                      <div className="data-readout flex h-12 w-14 shrink-0 items-center justify-end text-right text-[12px] font-medium text-[var(--text-secondary)]">
                        第 {level + 1} 层
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-6">
                        {layerTags.map((tag) => {
                          const active = selectedNodeId === tag.id;
                          const dimmed = relatedNodeIds != null && !relatedNodeIds.has(tag.id);
                          const count = itemsByTag.get(tag.id)?.length ?? 0;
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              data-graph-node-id={tag.id}
                              aria-pressed={active}
                              ref={(el) => {
                                if (el) nodeRefs.current.set(tag.id, el);
                                else nodeRefs.current.delete(tag.id);
                              }}
                              onClick={() => selectNode(tag.id)}
                              onDoubleClick={() => applyFilter(tag.id)}
                              className={`relative flex max-w-full shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-5 py-3 text-base shadow-[var(--shadow-card)]${dimmed ? " opacity-55" : ""}`}
                              style={{
                                borderColor: active
                                  ? tag.color
                                  : `color-mix(in srgb, ${tag.color} 36%, var(--border-subtle))`,
                                backgroundColor: active
                                  ? `color-mix(in srgb, ${tag.color} 20%, var(--bg-card))`
                                  : "var(--bg-card)",
                                color: active ? `color-mix(in srgb, var(--text-primary) 72%, ${tag.color})` : "var(--text-primary)",
                                fontWeight: 500,
                              }}
                              title={`${tag.name}（${count} 个对象）双击直接筛选`}
                            >
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                              <span className="min-w-0 max-w-[180px] truncate">{tag.name}</span>
                              <span
                                className="ml-1 inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-full)] px-1.5 text-[13px] font-semibold"
                                style={{
                                  backgroundColor: `color-mix(in srgb, ${tag.color} 9%, var(--bg-elevated))`,
                                  color: `color-mix(in srgb, var(--text-primary) 72%, ${tag.color})`,
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
            <div className="graph-details flex w-80 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]" aria-label="标签详情">
              <div className="border-b border-[var(--border-subtle)] px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: selectedTag.color }} />
                  <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-primary)]">{selectedTag.name}</h3>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="icon-button h-7 w-7"
                    title="收起"
                    aria-label="收起标签详情"
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
                            key={p.id}
                            type="button"
                            onClick={() => selectNode(p.id)}
                            className="tag-pill px-1.5 py-0.5"
                            style={{ "--tag-color": p.color } as CSSProperties}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedChildren.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[var(--text-faint)]">子：</span>
                        {selectedChildren.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectNode(c.id)}
                            className="tag-pill px-1.5 py-0.5"
                            style={{ "--tag-color": c.color } as CSSProperties}
                          >
                            {c.name}
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
                    {selectedItems.slice(0, visibleCount).map((it) => (
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
                    {selectedItems.length > visibleCount && (
                      <button
                        type="button"
                        onClick={() => setVisibleCount((n) => n + RIGHT_PANEL_PAGE_SIZE)}
                        className="mt-1 w-full rounded-[var(--radius-md)] px-2 py-1.5 text-center text-xs text-[var(--accent-primary)] hover:bg-[var(--bg-hover)]"
                      >
                        显示更多（剩 {selectedItems.length - visibleCount}）
                      </button>
                    )}
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

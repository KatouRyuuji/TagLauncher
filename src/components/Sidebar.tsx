import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  GitFork,
  Info,

  Library,
  Network,
  Plus,
  RefreshCw,
  Star,
  Tag as TagIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { TagEditor } from "./TagEditor";
import { TagRelationsEditor } from "./TagRelationsEditor";
import { SidebarThemeSwitcher } from "./SidebarThemeSwitcher";
import { resolvePanel, destroyPanel } from "../lib/panelRegistry";
import { buildDescendantsMap } from "../lib/tagGraph";
import { flattenTagTree } from "../lib/tagTree";
import { onCabinetItemsChanged } from "../lib/modApi";
import { useImeComposition } from "../hooks/useImeComposition";
import * as db from "../lib/db";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";
import { useAppStore } from "../stores/appStore";
import { showToast } from "../lib/toast";
import {
  shouldSuppressInternalDragClick,
  useInternalDragStore,
} from "../stores/internalDragStore";
import type { Cabinet, Tag, ItemWithTags } from "../types";
import type { PanelDescriptor } from "../types/panel";

interface SidebarProps {
  mobileOpen?: boolean;
  /** 主工作区加载中：标签/文件柜列表渲染骨架行，不提前定论「暂无」 */
  loading?: boolean;
  tags: Tag[];
  cabinets: Cabinet[];
  onAddTag: (name: string, color: string) => Promise<unknown>;
  onUpdateTag: (id: number, name: string, color: string) => Promise<void>;
  onRemoveTag: (id: number) => Promise<void>;
  onAddCabinet: (name: string, color: string) => Promise<unknown>;
  onUpdateCabinet: (id: number, name: string, color: string) => Promise<void>;
  onRemoveCabinet: (id: number) => Promise<void>;
  onAddTagToItem: (itemId: number, tagId: number) => Promise<void>;
  onAddTagRelation: (parentId: number, childId: number) => Promise<void>;
  onRemoveTagRelation: (parentId: number, childId: number) => Promise<void>;
  allItems: ItemWithTags[];
  modPanels?: PanelDescriptor[];
}

/** 标签区加载骨架条的宽度循环（错落宽度模拟真实标签行长度不一） */
const SIDEBAR_SKELETON_WIDTHS = ["w-[92%]", "w-[64%]", "w-[80%]", "w-[52%]"] as const;

export function Sidebar({
  mobileOpen = false,
  loading = false,
  tags,
  cabinets,
  onAddTag,
  onUpdateTag,
  onRemoveTag,
  onAddCabinet,
  onUpdateCabinet,
  onRemoveCabinet,
  onAddTagToItem,
  onAddTagRelation,
  onRemoveTagRelation,
  allItems,
  modPanels = [],
}: SidebarProps) {
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const toggleTagExclusion = useAppStore((state) => state.toggleTagExclusion);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const setTagGraphOpen = useAppStore((state) => state.setTagGraphOpen);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const setSelectedCabinetId = useAppStore((state) => state.setSelectedCabinetId);
  const sidebarTab = useAppStore((state) => state.sidebarTab);
  const setSidebarTab = useAppStore((state) => state.setSidebarTab);
  const sidebarHintDismissed = useAppStore((state) => state.sidebarHintDismissed);
  const setSidebarHintDismissed = useAppStore((state) => state.setSidebarHintDismissed);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const setShowFavorites = useAppStore((state) => state.setShowFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const setShowRecent = useAppStore((state) => state.setShowRecent);
  const activeDragKind = useInternalDragStore((state) => state.drag?.kind ?? null);
  const hoveredCabinetId = useInternalDragStore((state) =>
    state.drag?.kind === "item" && state.hoverTarget?.kind === "item-cabinet"
      ? state.hoverTarget.cabinetId
      : null,
  );
  const hoveredFavorites = useInternalDragStore((state) =>
    state.drag?.kind === "item" && state.hoverTarget?.kind === "item-favorites",
  );

  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [showAddTag, setShowAddTag] = useState(false);
  const [editingCabinet, setEditingCabinet] = useState<Cabinet | null>(null);
  const [showAddCabinet, setShowAddCabinet] = useState(false);
  const [showRelationsEditor, setShowRelationsEditor] = useState(false);
  const [collapsedTagIds, setCollapsedTagIds] = useState<Set<number>>(() => new Set());
  const initializedTagTreeRef = useRef(false);
  const wasLibraryEmptyRef = useRef(allItems.length === 0);
  const visibleSection = activeDragKind === "item" ? "cabinets" : sidebarTab;
  const favoriteCount = useMemo(
    () => allItems.reduce((count, item) => count + (item.is_favorite ? 1 : 0), 0),
    [allItems],
  );
  const recentCount = useMemo(
    () => allItems.reduce((count, item) => count + (item.last_used_at ? 1 : 0), 0),
    [allItems],
  );

  // 计数与单击筛选同一口径：父标签并入后代，避免侧栏写 3、点开却是 4。
  const itemCountByTag = useMemo(() => {
    const descendants = buildDescendantsMap(tagRelations);
    const includedBy = new Map<number, number[]>();
    const tagIds = new Set(tags.map((tag) => tag.id));
    for (const tagId of tagIds) {
      const closure = descendants.get(tagId) ?? new Set([tagId]);
      for (const member of closure) {
        const owners = includedBy.get(member) ?? [];
        owners.push(tagId);
        includedBy.set(member, owners);
      }
    }
    const counts = new Map<number, number>();
    for (const item of allItems) {
      const credited = new Set<number>();
      for (const tag of item.tags) {
        for (const owner of includedBy.get(tag.id) ?? [tag.id]) credited.add(owner);
      }
      for (const id of credited) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [allItems, tags, tagRelations]);

  const tagRows = useMemo(
    () =>
      flattenTagTree(
        tags,
        tagRelations,
        (a, b) => (itemCountByTag.get(b.id) ?? 0) - (itemCountByTag.get(a.id) ?? 0),
      ),
    [tags, tagRelations, itemCountByTag],
  );

  // 标签迷你过滤（标签多时不靠滚动找）；命中行保留原缩进以不丢层级语境。
  // 显示文本（tagQuery）与应用查询（appliedTagQuery）分离：IME 组合中只更新文本，
  // 组合结束才过滤，列表不随中间拼音串抖动
  const [tagQuery, setTagQuery] = useState("");
  const [appliedTagQuery, setAppliedTagQuery] = useState("");
  const tagFilterIme = useImeComposition<string>(setAppliedTagQuery);
  const filteredTagRows = useMemo(() => {
    const q = appliedTagQuery.trim().toLowerCase();
    if (!q) return tagRows;
    return tagRows.filter(({ tag }) => tag.name.toLowerCase().includes(q));
  }, [tagRows, appliedTagQuery]);

  useEffect(() => {
    if (tags.length === 0) return;
    const libraryEmpty = allItems.length === 0;
    if (!initializedTagTreeRef.current || libraryEmpty !== wasLibraryEmptyRef.current) {
      setCollapsedTagIds(
        libraryEmpty
          ? new Set(tagRows.filter((row) => row.hasChildren).map((row) => row.tag.id))
          : new Set(),
      );
      initializedTagTreeRef.current = true;
      wasLibraryEmptyRef.current = libraryEmpty;
    }
  }, [allItems.length, tags.length, tagRows]);

  const visibleTagRows = useMemo(() => {
    if (appliedTagQuery.trim()) return filteredTagRows;
    const visible: typeof filteredTagRows = [];
    const ancestorIds: number[] = [];
    for (const row of filteredTagRows) {
      const hidden = ancestorIds.slice(0, row.depth).some((id) => collapsedTagIds.has(id));
      ancestorIds.length = row.depth;
      ancestorIds[row.depth] = row.tag.id;
      if (!hidden) visible.push(row);
    }
    return visible;
  }, [appliedTagQuery, collapsedTagIds, filteredTagRows]);

  // 已选标签滚出可视区时自动定位：侧栏既是选择器也是状态显示器
  const tagScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = selectedTagIds[0];
    if (first == null) return;
    tagScrollRef.current
      ?.querySelector(`[data-tag-row-id="${first}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedTagIds]);

  const [itemCountByCabinet, setItemCountByCabinet] = useState<Map<number, number>>(() => new Map());

  // 计数重算抽为独立函数：除了 cabinets/列表规模变化触发外，还要响应
  // 柜内成员变更事件（拖拽入库不改变 cabinets 引用也不改 allItems.length，
  // 仅靠依赖数组会漏刷——notifyCabinetItemsChanged 事件正是为此存在）。
  useEffect(() => {
    if (cabinets.length === 0) {
      setItemCountByCabinet(new Map());
      return;
    }
    let cancelled = false;
    const reload = async () => {
      try {
        const counts = await db.getCabinetItemCounts();
        if (!cancelled) setItemCountByCabinet(counts);
      } catch {
        if (!cancelled) setItemCountByCabinet(new Map());
      }
    };
    void reload();
    const unsubCabinetItems = onCabinetItemsChanged(() => { void reload(); });
    return () => {
      cancelled = true;
      unsubCabinetItems();
    };
  }, [cabinets, allItems.length]);

  const handleTagPointerDown = (event: React.PointerEvent<HTMLElement>, tag: Tag) => {
    beginInternalPointerDrag({
      event,
      payload: {
        kind: "tag",
        tagId: tag.id,
        label: tag.name,
        color: tag.color,
      },
      findHoverTarget: (pointerEvent) => {
        const itemId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-tag-item-id]",
          "dropTagItemId",
        );
        return itemId === null ? null : { kind: "tag-item", itemId };
      },
      onDrop: async (target) => {
        if (target?.kind === "tag-item") {
          await onAddTagToItem(target.itemId, tag.id);
        }
      },
    });
  };

  const handleTagClick = (event: React.MouseEvent, tagId: number) => {
    if (shouldSuppressInternalDragClick()) return;
    if (event.altKey) {
      toggleTagExclusion(tagId);
      return;
    }
    toggleTagSelection(tagId);
  };

  const handleCabinetClick = (cabinetId: number) => {
    if (shouldSuppressInternalDragClick()) return;
    setSelectedCabinetId(selectedCabinetId === cabinetId ? null : cabinetId);
  };

  return (
    <aside
      id="workspace-sidebar"
      data-region="sidebar"
      aria-label="资源导航"
      className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-base)] ${mobileOpen ? "is-mobile-open" : ""}`}
      style={{ width: "var(--sidebar-width)" }}
    >
      {/* 顶部不再放库概览统计：项目/标签/文件柜计数在导航行与分区标题里已各有一处，
          同屏重复且层级弱（品牌标识在窗口栏，侧栏直接给导航） */}

      <div data-region="sidebar-nav" className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="工作台导航"
        className="shrink-0 px-2 py-3"
      >
        <section aria-labelledby="sidebar-navigation-label">
          <h2 id="sidebar-navigation-label" className="sr-only">导航</h2>
          <div className="mt-1 space-y-0.5">
            <FilterNavButton
              active={selectedTagIds.length === 0 && excludedTagIds.length === 0 && selectedCabinetId === null && !showFavorites && !showRecent}
              title="全部项目"
              subtitle="查看库里的全部项目"
              icon={Library}
              count={allItems.length}
              onClick={() => {
                setSelectedTagIds([]);
                setSelectedCabinetId(null);
                setShowFavorites(false);
                setShowRecent(false);
              }}
            />
            <FilterNavButton
              active={showFavorites}
              title="收藏夹"
              subtitle="优先展示常用项目"
              accent={hoveredFavorites ? "favorite" : undefined}
              icon={Star}
              count={favoriteCount}
              onClick={() => setShowFavorites(!showFavorites)}
              data-drop-item-favorite={1}
            />
            <FilterNavButton
              active={showRecent}
              title="最近使用"
              subtitle="打开过的项目"
              icon={Clock}
              count={recentCount}
              onClick={() => setShowRecent(!showRecent)}
            />
          </div>
        </section>
      </nav>

      <div className="shrink-0 px-2 py-2">
        <div className="segmented-control flex w-full" role="group" aria-label="资源分类">
          <SidebarTabButton
            active={visibleSection === "tags"}
            label="标签"
            icon={TagIcon}
            onClick={() => setSidebarTab("tags")}
          />
          <SidebarTabButton
            active={visibleSection === "cabinets"}
            label="文件柜"
            icon={Folder}
            onClick={() => setSidebarTab("cabinets")}
          />
        </div>
      </div>

      {activeDragKind === "item" && sidebarTab !== "cabinets" && (
        <div
          role="status"
          className="mx-2 mt-2 flex shrink-0 items-center gap-2 border-l-2 border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)] px-2.5 py-2 text-[13px] leading-4 text-[var(--accent-primary-ink)]"
        >
          <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <span>项目拖拽中，已显示文件柜</span>
        </div>
      )}

      <div ref={tagScrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {visibleSection === "tags" && (
          <div className="space-y-5">
            <section aria-labelledby="sidebar-tags-label">
              <SectionHeader id="sidebar-tags-label" label="标签" count={loading ? undefined : tags.length}>
                <SidebarIconButton label="管理标签父子关系" onClick={() => setShowRelationsEditor(true)}>
                  <GitFork className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                </SidebarIconButton>
                <SidebarIconButton label="打开标签关系图" onClick={() => setTagGraphOpen(true)}>
                  <Network className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                </SidebarIconButton>
                <SidebarIconButton
                    disabled={selectedTagIds.length === 0 && excludedTagIds.length === 0}
                    label="清空标签筛选"
                    onClick={() => setSelectedTagIds([])}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                </SidebarIconButton>
              </SectionHeader>

              {loading ? (
                <div className="mt-1 space-y-0.5" aria-busy="true" aria-label="标签加载中">
                  {/* 与真实标签行同构：颜色标记占位 + 错落宽度的名称条。 */}
                  {[0, 1, 2, 3, 4].map((row) => (
                    <div key={row} className="flex h-8 items-center gap-2 px-1">
                      <span className="skeleton-block h-3.5 w-1 shrink-0 rounded-sm" />
                      <span className={`skeleton-block h-3.5 rounded ${SIDEBAR_SKELETON_WIDTHS[row % SIDEBAR_SKELETON_WIDTHS.length]}`} />
                    </div>
                  ))}
                </div>
              ) : (
              <>
              {tags.length >= 10 && (
                <input
                  type="search"
                  value={tagQuery}
                  onChange={(event) => { setTagQuery(event.target.value); tagFilterIme.onChange(event.target.value); }}
                  onCompositionStart={tagFilterIme.onCompositionStart}
                  onCompositionEnd={tagFilterIme.onCompositionEnd}
                  placeholder="过滤标签…"
                  aria-label="过滤标签"
                  className="input-frame mb-1 h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-placeholder)]"
                />
              )}
              <div className="mt-1 space-y-0.5">
                {visibleTagRows.map(({ tag, depth, hasChildren }) => {
                  const active = selectedTagIds.includes(tag.id);
                  const excluded = excludedTagIds.includes(tag.id);
                  const collapsed = collapsedTagIds.has(tag.id);
                  const canCollapse = hasChildren && !appliedTagQuery.trim();
                  const activeTagStyle = active
                    ? {
                        borderColor: "transparent",
                        backgroundColor: "var(--accent-primary-bg)",
                      }
                    : undefined;
                  return (
                    <div
                      key={tag.id}
                      className={`flex h-8 min-w-0 items-center gap-0.5 ${depth === 1 ? "ml-3" : depth === 2 ? "ml-6" : ""}`}
                    >
                      {canCollapse ? (
                        <button
                          type="button"
                          aria-label={`${collapsed ? "展开" : "折叠"} ${tag.name}的下级标签`}
                          aria-expanded={!collapsed}
                          onClick={() => setCollapsedTagIds((current) => {
                            const next = new Set(current);
                            if (next.has(tag.id)) next.delete(tag.id);
                            else next.add(tag.id);
                            return next;
                          })}
                          className="flex h-7 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          {collapsed
                            ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                            : <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
                        </button>
                      ) : (
                        <span className="w-6 shrink-0" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        data-tag-row-id={tag.id}
                        aria-pressed={active}
                        aria-label={excluded ? `${tag.name}（已排除）` : undefined}
                        style={activeTagStyle}
                        onPointerDown={(event) => handleTagPointerDown(event, tag)}
                        onClick={(event) => handleTagClick(event, tag.id)}
                        title={hasChildren ? "单击筛选并包含下级标签；Alt+单击排除" : "单击筛选；Alt+单击排除"}
                        onKeyDown={(event) => {
                          if (event.key === "F2" || event.key === "Delete") {
                            event.preventDefault();
                            setEditingTag(tag);
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setEditingTag(tag);
                        }}
                        className={`group/tag flex h-8 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-left transition-colors active:cursor-grabbing ${
                          active
                            ? "font-semibold text-[var(--text-primary)]"
                            : excluded
                              ? "border-transparent text-[var(--text-faint)]"
                              : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <span
                          data-tag-color-mark=""
                          className="h-[10px] w-[10px] shrink-0 rounded-[3px]"
                          style={{
                            backgroundColor: excluded
                              ? "var(--text-faint)"
                              : tag.color,
                          }}
                          aria-hidden="true"
                        />
                        <span className={`min-w-0 flex-1 truncate text-[13px] ${depth === 0 ? "font-medium" : "font-normal"} ${excluded ? "line-through" : ""}`}>{tag.name}</span>
                        <NavCount value={itemCountByTag.get(tag.id) ?? 0} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {tags.length === 0 && (
                <div className="mt-1 border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[13px] leading-5 text-[var(--text-muted)]">
                  暂无标签
                </div>
              )}
              </>
              )}

              <AddRowButton label="新建标签" onClick={() => setShowAddTag(true)} />
            </section>
          </div>
        )}

        {visibleSection === "cabinets" && (
          <div className="space-y-5">
            <section aria-labelledby="sidebar-cabinets-label">
              <SectionHeader id="sidebar-cabinets-label" label="文件柜" count={cabinets.length}>
                <SidebarIconButton
                    disabled={selectedCabinetId === null}
                    label="取消当前文件柜筛选"
                    onClick={() => setSelectedCabinetId(null)}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                </SidebarIconButton>
              </SectionHeader>

              <div className="mt-1 space-y-0.5">
                {cabinets.map((cabinet) => {
                  const active = selectedCabinetId === cabinet.id;
                  const hovered = hoveredCabinetId === cabinet.id;
                  const activeCabinetStyle = active
                    ? { boxShadow: "inset 3px 0 0 var(--accent-primary)" }
                    : undefined;
                  return (
                    <button
                      key={cabinet.id}
                      type="button"
                      data-drop-item-cabinet-id={cabinet.id}
                      aria-pressed={active}
                      style={activeCabinetStyle}
                      onClick={() => handleCabinetClick(cabinet.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setEditingCabinet(cabinet);
                      }}
                      onKeyDown={(event) => {
                        // 键盘可达的编辑入口（对齐右键菜单）：F2 重命名 / Delete 删除，均打开编辑弹窗
                        if (event.key === "F2" || event.key === "Delete") {
                          event.preventDefault();
                          setEditingCabinet(cabinet);
                        }
                      }}
                      className={`flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-left transition-colors ${
                        hovered
                          ? "border-transparent bg-[var(--accent-primary-bg-light)] text-[var(--accent-primary-ink)]"
                          : active
                            ? "border-transparent bg-[var(--accent-primary-bg)] font-semibold text-[var(--text-primary)]"
                            : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-[color-mix(in_srgb,var(--border-strong)_42%,transparent)]"
                        style={{ backgroundColor: cabinet.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{cabinet.name}</span>
                      <NavCount value={itemCountByCabinet.get(cabinet.id) ?? 0} />
                    </button>
                  );
                })}
              </div>

              {cabinets.length === 0 && (
                <div className="mt-1 border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[13px] leading-5 text-[var(--text-muted)]">
                  暂无文件柜
                </div>
              )}

              <AddRowButton label="新建文件柜" onClick={() => setShowAddCabinet(true)} />
            </section>
          </div>
        )}
      </div>
      </div>

      {modPanels.filter((panel) => panel.visible !== false).length > 0 && (
        <div
          data-region="sidebar-panels"
          className="max-h-[38%] shrink-0 overflow-y-auto border-t border-[var(--line-hairline)] px-2 py-2"
        >
          <div className="px-1.5 py-1">
            <span className="instrument-label">扩展面板</span>
          </div>
          {modPanels
            .filter((panel) => panel.visible !== false)
            .map((panel) => (
              <SidebarPanelSlot key={panel.id} panel={panel} />
            ))}
        </div>
      )}

      <SidebarThemeSwitcher />

      {(!sidebarHintDismissed || activeDragKind === "item") && (
        <div
          data-region="sidebar-hint"
          className="flex h-8 shrink-0 items-center gap-2 px-3 text-[12px] leading-4 text-[var(--text-muted)]"
        >
          <Info className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={activeDragKind === "item" ? "释放到收藏夹或文件柜完成归档（不会移动磁盘文件）" : "拖标签到项目打标，拖项目到文件柜。文件柜是分组，不是磁盘文件夹。"}>
            {activeDragKind === "item" ? "松开即归档，不移动文件" : "拖放打标，不移动文件"}
          </span>
          {activeDragKind !== "item" && (
            <button
              type="button"
              className="icon-button"
              aria-label="关闭提示"
              title="关闭提示"
              onClick={() => setSidebarHintDismissed(true)}
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      )}

      {(showAddTag || editingTag) && (
        <TagEditor
          tag={editingTag}
          onSave={async (name, color) => {
            if (editingTag) {
              await onUpdateTag(editingTag.id, name, color);
            } else {
              await onAddTag(name, color);
            }
            setEditingTag(null);
            setShowAddTag(false);
          }}
          onDelete={editingTag ? () => {
            void onRemoveTag(editingTag.id).catch((err: unknown) =>
              showToast(`删除标签失败：${err instanceof Error ? err.message : String(err)}`, "error"),
            );
            setEditingTag(null);
          } : undefined}
          onClose={() => {
            setEditingTag(null);
            setShowAddTag(false);
          }}
        />
      )}

      {(showAddCabinet || editingCabinet) && (
        <TagEditor
          tag={editingCabinet ? { id: editingCabinet.id, name: editingCabinet.name, color: editingCabinet.color } : null}
          label="文件柜"
          onSave={async (name, color) => {
            if (editingCabinet) {
              await onUpdateCabinet(editingCabinet.id, name, color);
            } else {
              await onAddCabinet(name, color);
            }
            setEditingCabinet(null);
            setShowAddCabinet(false);
          }}
          onDelete={editingCabinet ? () => {
            void onRemoveCabinet(editingCabinet.id).catch((err: unknown) =>
              showToast(`删除文件柜失败：${err instanceof Error ? err.message : String(err)}`, "error"),
            );
            setEditingCabinet(null);
          } : undefined}
          onClose={() => {
            setEditingCabinet(null);
            setShowAddCabinet(false);
          }}
        />
      )}

      {showRelationsEditor && (
        <TagRelationsEditor
          tags={tags}
          allItems={allItems}
          onAddRelation={onAddTagRelation}
          onRemoveRelation={onRemoveTagRelation}
          onClose={() => setShowRelationsEditor(false)}
        />
      )}
    </aside>
  );
}

function SectionHeader({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-1 px-1.5">
      <h2 id={id} className="instrument-label truncate">
        {label}
      </h2>
      {typeof count === "number" && (
        <span className="data-readout text-[13px] text-[var(--text-faint)]">{count}</span>
      )}
      {children && <div className="ml-auto flex shrink-0 items-center gap-0.5">{children}</div>}
    </div>
  );
}

function SidebarIconButton({
  disabled,
  label,
  onClick,
  children,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-transparent text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-primary)] disabled:cursor-default disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
    >
      {children}
    </button>
  );
}

function NavCount({ value }: { value: number }) {
  return (
    <span className={`min-w-6 shrink-0 text-right text-[12px] tabular-nums text-[var(--text-muted)] ${value === 0 ? "opacity-40" : ""}`}>
      {value}
    </span>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-2 text-[13px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--accent-primary-bg-light)] hover:text-[var(--accent-primary)]"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function SidebarTabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[13px] font-medium transition-colors ${
        active
          ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function FilterNavButton({
  active,
  title,
  subtitle,
  onClick,
  accent,
  icon: Icon,
  count,
  className,
  style,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  title: string;
  subtitle: string;
  accent?: "favorite";
  icon: LucideIcon;
  count?: number;
}) {
  const accentStyle = accent === "favorite"
    ? {
        borderColor: "color-mix(in srgb, var(--color-favorite) 30%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--color-favorite) 12%, transparent)",
        color: "var(--color-favorite)",
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={subtitle}
      className={`flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-left transition-colors ${
        active
          ? "border-transparent bg-[var(--accent-primary-bg)] font-semibold text-[var(--accent-primary-ink)]"
          : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      } ${className ?? ""}`}
      style={{
        ...style,
        ...accentStyle,
      }}
      {...props}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
      {typeof count === "number" && <NavCount value={count} />}
    </button>
  );
}

function SidebarPanelSlot({ panel }: { panel: PanelDescriptor }) {
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      resolvePanel(panel.id, containerRef.current);
    }
  }, [panel.id]);

  return (
    <div className="mt-1 border border-[var(--line-hairline)] bg-[color-mix(in_srgb,var(--bg-card)_72%,transparent)] p-1">
      {panel.collapsible ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          )}
          <span className="truncate font-medium">{panel.title}</span>
        </button>
      ) : (
        <div className="flex h-8 items-center gap-2 px-2 text-[13px] text-[var(--text-secondary)]">
          <span className="min-w-0 flex-1 truncate font-medium">{panel.title}</span>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={() => {
              // destroyPanel 内部统一派发 close 事件并清理（有重入守卫），
              // 不要先手动 fire 一次否则 close 监听会被调用两次
              destroyPanel(panel.id);
            }}
            title="关闭"
            aria-label={`关闭${panel.title}`}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="mx-1 min-h-10 px-1.5 py-1 text-[var(--text-primary)]"
        style={{ fontSize: "var(--font-size-sm)", display: collapsed ? "none" : undefined }}
      />
    </div>
  );
}

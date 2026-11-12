import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderSync,
  GitFork,
  Info,
  ListTree,

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
import { filterCollapsedTagRows, flattenTagTree } from "../lib/tagTree";
import { compareSortOrder, moveBeside } from "../lib/sidebarOrder";
import { cabinetPathLabel, canNestCabinet, flattenCabinetTree, parentCandidates } from "../lib/cabinetTree";
import { scopedTagSearch, scopeSearchKey } from "../lib/tagScopeSearch";
import { TagScopeNotice } from "./TagScopeNotice";
import { describeParentChange, resolveHierarchyDrop, type HierarchyDropTarget } from "../lib/tagHierarchyDrag";
import { compareNames } from "../lib/itemQuery";
import { matchesNameQuery } from "../lib/nameMatch";
import { findTagByNameInsensitive } from "../lib/tagNames";
import { ensurePinyin } from "../lib/pinyinProvider";
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
import type { Cabinet, Tag } from "../types";
import type { LibraryStats } from "../lib/db";
import type { PanelDescriptor } from "../types/panel";

interface SidebarProps {
  mobileOpen?: boolean;
  /** 主工作区加载中：标签/文件柜列表渲染骨架行，不提前定论「暂无」 */
  loading?: boolean;
  tags: Tag[];
  cabinets: Cabinet[];
  onAddTag: (name: string, color: string) => Promise<Tag>;
  onUpdateTag: (id: number, name: string, color: string) => Promise<void>;
  onRemoveTag: (id: number) => Promise<void>;
  onAddCabinet: (name: string, color: string) => Promise<unknown>;
  onUpdateCabinet: (id: number, name: string, color: string) => Promise<void>;
  onRemoveCabinet: (id: number) => Promise<void>;
  /** 按给定 id 顺序写入侧栏手动顺序 */
  onReorderTags: (ids: number[]) => Promise<void>;
  onReorderCabinets: (ids: number[]) => Promise<void>;
  /** 关联 / 解除文件柜的磁盘文件夹 */
  onSetCabinetFolder?: (id: number, folder: string | null) => Promise<void>;
  /** 设置父柜（null = 顶层；F16 嵌套） */
  onSetCabinetParent?: (id: number, parentId: number | null) => Promise<void>;
  onAddTagToItem: (itemId: number, tagId: number) => Promise<void>;
  onAddTagRelation: (parentId: number, childId: number) => Promise<void>;
  onRemoveTagRelation: (parentId: number, childId: number) => Promise<void>;
  /** 「编辑层级」拖动：加边 / 换边 / 移到顶层（一个事务，F14） */
  onMoveTagParent: (childId: number, fromParentId: number | null, toParentId: number | null) => Promise<void>;
  /** 库计数（后端按全库算；侧栏不持有对象数据） */
  stats: LibraryStats | null;
  /** 数据代：对象数据变化时递增（关系编辑器的关联对象据此重取） */
  dataEpoch: number;
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
  onReorderTags,
  onReorderCabinets,
  onSetCabinetFolder,
  onSetCabinetParent,
  onAddTagToItem,
  onAddTagRelation,
  onRemoveTagRelation,
  onMoveTagParent,
  stats,
  dataEpoch,
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
  const tagInsert = useInternalDragStore((state) =>
    state.hoverTarget?.kind === "sidebar-tag" ? state.hoverTarget : null,
  );
  const parentDrop = useInternalDragStore((state) =>
    state.hoverTarget?.kind === "tag-parent" ? state.hoverTarget : null,
  );
  const rootDrop = useInternalDragStore((state) =>
    state.hoverTarget?.kind === "tag-root" ? state.hoverTarget : null,
  );
  // 「编辑层级」模式（F14）：拖动改父子关系；与拖动排序 / 拖到对象打标签分开，避免手势冲突
  const [hierarchyEditing, setHierarchyEditing] = useState(false);
  const cabinetInsert = useInternalDragStore((state) =>
    state.hoverTarget?.kind === "sidebar-cabinet" ? state.hoverTarget : null,
  );

  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [showAddTag, setShowAddTag] = useState(false);
  const [editingCabinet, setEditingCabinet] = useState<Cabinet | null>(null);
  const [collapsedCabinets, setCollapsedCabinets] = useState<Set<number>>(loadCollapsedCabinets);
  const toggleCabinetCollapsed = useCallback((id: number, collapse?: boolean) => {
    setCollapsedCabinets((prev) => {
      const next = new Set(prev);
      if (collapse ?? !next.has(id)) next.add(id);
      else next.delete(id);
      saveCollapsedCabinets(next);
      return next;
    });
  }, []);
  const cabinetRows = useMemo(() => flattenCabinetTree(cabinets, collapsedCabinets), [cabinets, collapsedCabinets]);
  const [showAddCabinet, setShowAddCabinet] = useState(false);
  // null = 关闭；打开时记下要对准的标签（右键所在标签或侧栏当前选中标签）
  const [relationsEditor, setRelationsEditor] = useState<{ initialTagId: number | null } | null>(null);
  const [collapsedTagPaths, setCollapsedTagPaths] = useState<Set<string>>(() => new Set());
  const initializedTagTreeRef = useRef(false);
  const libraryTotal = stats?.total ?? 0;
  const wasLibraryEmptyRef = useRef(libraryTotal === 0);
  const visibleSection = activeDragKind === "item" ? "cabinets" : sidebarTab;
  const favoriteCount = stats?.favorites ?? 0;
  const recentCount = stats?.recent ?? 0;

  // 计数与单击筛选同一口径：父标签并入后代，避免侧栏写 3、点开却是 4（后端按 useItems 给的后代组算）。
  const itemCountByTag = useMemo(() => new Map<number, number>(stats?.tagCounts ?? []), [stats]);

  // 同级先按手动顺序，未拖动过的（同为 0）按计数降序、再按名称
  const compareTagRows = useCallback(
    (a: Tag, b: Tag) =>
      compareSortOrder(a, b) ||
      (itemCountByTag.get(b.id) ?? 0) - (itemCountByTag.get(a.id) ?? 0) ||
      compareNames(a.name, b.name),
    [itemCountByTag],
  );
  const tagRows = useMemo(
    () => flattenTagTree(tags, tagRelations, compareTagRows),
    [tags, tagRelations, compareTagRows],
  );

  // 标签迷你过滤（标签多时不靠滚动找）；命中行保留原缩进以不丢层级语境。
  // 显示文本（tagQuery）与应用查询（appliedTagQuery）分离：IME 组合中只更新文本，
  // 组合结束才过滤，列表不随中间拼音串抖动
  const [tagQuery, setTagQuery] = useState("");
  const [appliedTagQuery, setAppliedTagQuery] = useState("");
  const tagFilterIme = useImeComposition<string>(setAppliedTagQuery);
  // 拼音/首字母过滤（BUG-16）：pinyin-pro 懒加载，有过滤词时才拉取，就绪后重算
  const [pinyinReady, setPinyinReady] = useState(false);
  useEffect(() => {
    if (pinyinReady || !appliedTagQuery.trim()) return;
    let cancelled = false;
    void ensurePinyin().then(() => { if (!cancelled) setPinyinReady(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [appliedTagQuery, pinyinReady]);
  // F04c：有已选标签（当前层）时先只在当前层及下级里过滤，没有命中再提示转全局
  // 转全局只对当时的「当前层 + 过滤词」有效；任一变化即回到当前层（不靠 effect 清理，整段替换过滤词也成立）
  const [tagSearchGlobalKey, setTagSearchGlobalKey] = useState<string | null>(null);
  const tagSearchKey = scopeSearchKey(selectedTagIds, appliedTagQuery);
  const tagSearchGlobal = tagSearchGlobalKey === tagSearchKey;
  const setTagSearchGlobal = (global: boolean) => setTagSearchGlobalKey(global ? tagSearchKey : null);
  const tagSearch = useMemo(() => {
    const q = appliedTagQuery.trim().toLowerCase();
    return scopedTagSearch(tagRows, tagRelations, selectedTagIds, q, (name) => matchesNameQuery(name, q, pinyinReady), tagSearchGlobal);
  }, [tagRows, tagRelations, selectedTagIds, appliedTagQuery, pinyinReady, tagSearchGlobal]);
  const filteredTagRows = tagSearch.rows;
  const scopeLabel = selectedTagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean).join("、");

  useEffect(() => {
    if (tags.length === 0) return;
    const libraryEmpty = libraryTotal === 0;
    if (!initializedTagTreeRef.current || libraryEmpty !== wasLibraryEmptyRef.current) {
      setCollapsedTagPaths(
        libraryEmpty
          ? new Set(tagRows.filter((row) => row.hasChildren).map((row) => row.pathKey))
          : new Set(),
      );
      initializedTagTreeRef.current = true;
      wasLibraryEmptyRef.current = libraryEmpty;
    }
  }, [libraryTotal, tags.length, tagRows]);

  const visibleTagRows = useMemo(() => {
    if (appliedTagQuery.trim()) return filteredTagRows;
    return filterCollapsedTagRows(filteredTagRows, collapsedTagPaths);
  }, [appliedTagQuery, collapsedTagPaths, filteredTagRows]);

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
  }, [cabinets, libraryTotal]);

  // 拖动排序失败时提示；成功由列表本身反映
  const reorderWithToast = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (err) {
      showToast(`排序失败：${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  // 编辑层级：拖到标签上 = 成为它的子标签（默认加边保留原父级；按住 Alt 放下 = 从当前父级移过去），
  // 拖到顶部虚线框 = 移出当前父级。不可放的落点也给出原因（行上标红 + 放下时提示）。
  const handleHierarchyPointerDown = (event: React.PointerEvent<HTMLElement>, tag: Tag, parentId: number | null) => {
    const resolve = (target: HierarchyDropTarget) =>
      resolveHierarchyDrop(tag.id, parentId, target, useAppStore.getState().tagRelations);
    beginInternalPointerDrag({
      event,
      payload: { kind: "tag", tagId: tag.id, label: tag.name, color: tag.color },
      findHoverTarget: (pointerEvent) => {
        if (sidebarRowAt(pointerEvent, "[data-tag-root-drop]")) {
          const r = resolve({ kind: "root" });
          return { kind: "tag-root", blocked: r.ok ? null : r.reason };
        }
        const row = sidebarRowAt(pointerEvent, "[data-tag-row-id]");
        if (!row) return null;
        const targetId = Number(row.element.dataset.tagRowId);
        const move = pointerEvent.altKey;
        const r = resolve({ kind: "parent", parentId: targetId, move });
        return { kind: "tag-parent", tagId: targetId, move, blocked: r.ok ? null : r.reason };
      },
      onDrop: async (target) => {
        if (target?.kind !== "tag-parent" && target?.kind !== "tag-root") return;
        const r = resolve(target.kind === "tag-root" ? { kind: "root" } : { kind: "parent", parentId: target.tagId, move: target.move });
        if (!r.ok) {
          showToast(`无法调整层级：${r.reason}`, "info");
          return;
        }
        try {
          await onMoveTagParent(r.change.childId, r.change.fromParentId, r.change.toParentId);
          const nameOf = (id: number) => tags.find((t) => t.id === id)?.name ?? String(id);
          showToast(describeParentChange(r.change, nameOf), "success");
        } catch (err) {
          showToast(`调整层级失败：${err instanceof Error ? err.message : String(err)}`, "error");
        }
      },
    });
  };

  // 标签拖到对象上为打标签；拖到同一父级下的另一标签行为排序
  const handleTagPointerDown = (event: React.PointerEvent<HTMLElement>, tag: Tag, parentId: number | null) => {
    if (hierarchyEditing) {
      handleHierarchyPointerDown(event, tag, parentId);
      return;
    }
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
        if (itemId !== null) return { kind: "tag-item", itemId };
        const row = sidebarRowAt(pointerEvent, "[data-tag-row-id]");
        if (!row) return null;
        const targetId = Number(row.element.dataset.tagRowId);
        const targetParent = row.element.dataset.tagParentId ?? "";
        if (targetId === tag.id || targetParent !== String(parentId ?? "")) return null;
        return { kind: "sidebar-tag", tagId: targetId, after: row.after };
      },
      onDrop: async (target) => {
        if (target?.kind === "tag-item") {
          await onAddTagToItem(target.itemId, tag.id);
        } else if (target?.kind === "sidebar-tag") {
          const current = [...tags].sort(compareTagRows).map((entry) => entry.id);
          const next = moveBeside(current, tag.id, target.tagId, target.after);
          if (next) await reorderWithToast(() => onReorderTags(next));
        }
      },
    });
  };

  const handleCabinetPointerDown = (event: React.PointerEvent<HTMLElement>, cabinet: Cabinet) => {
    beginInternalPointerDrag({
      event,
      payload: {
        kind: "cabinet",
        cabinetId: cabinet.id,
        label: cabinet.name,
        color: cabinet.color,
      },
      findHoverTarget: (pointerEvent) => {
        const row = sidebarRowAt(pointerEvent, "[data-drop-item-cabinet-id]");
        if (!row) return null;
        const targetId = Number(row.element.dataset.dropItemCabinetId);
        if (targetId === cabinet.id) return null;
        const target = cabinets.find((entry) => entry.id === targetId);
        // 行中部 = 放进去成为子柜（需合法：不成环、目标不是关联文件夹柜）；上/下缘 = 排到它前/后
        if (onSetCabinetParent && row.middle && canNestCabinet(cabinets, cabinet.id, targetId)) {
          return { kind: "sidebar-cabinet", cabinetId: targetId, after: row.after, into: true };
        }
        const siblingParent = target?.parent_id ?? null;
        if (onSetCabinetParent && siblingParent !== (cabinet.parent_id ?? null) && !canNestCabinet(cabinets, cabinet.id, siblingParent)) {
          return null;
        }
        return { kind: "sidebar-cabinet", cabinetId: targetId, after: row.after };
      },
      onDrop: async (target) => {
        if (target?.kind !== "sidebar-cabinet") return;
        if (target.into) {
          if (cabinet.parent_id === target.cabinetId) return;
          await reorderWithToast(() => onSetCabinetParent!(cabinet.id, target.cabinetId));
          setCollapsedCabinets((prev) => {
            if (!prev.has(target.cabinetId)) return prev;
            const next = new Set(prev);
            next.delete(target.cabinetId);
            saveCollapsedCabinets(next);
            return next;
          });
          return;
        }
        const siblingParent = cabinets.find((entry) => entry.id === target.cabinetId)?.parent_id ?? null;
        if (onSetCabinetParent && siblingParent !== (cabinet.parent_id ?? null)) {
          await reorderWithToast(() => onSetCabinetParent(cabinet.id, siblingParent));
        }
        const next = moveBeside(cabinets.map((entry) => entry.id), cabinet.id, target.cabinetId, target.after);
        if (next) await reorderWithToast(() => onReorderCabinets(next));
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
              count={libraryTotal}
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
          className="mx-2 mt-2 flex shrink-0 items-center gap-2 border-l-2 border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)] px-2.5 py-2 text-[length:calc(13px*var(--ui-font-scale,1))] leading-4 text-[var(--accent-primary-ink)]"
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
                <button
                  type="button"
                  aria-pressed={hierarchyEditing}
                  aria-label="编辑层级"
                  title={hierarchyEditing ? "退出编辑层级" : "编辑层级：拖动标签调整父子关系"}
                  data-testid="tag-hierarchy-edit"
                  onClick={() => setHierarchyEditing((v) => !v)}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border ${
                    hierarchyEditing
                      ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                      : "border-transparent text-[var(--text-muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-primary)]"
                  }`}
                >
                  <ListTree className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                </button>
                <SidebarIconButton label="管理标签父子关系" onClick={() => setRelationsEditor({ initialTagId: selectedTagIds[0] ?? null })}>
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && tagSearch.scope === "subtree" && tagSearch.subtreeCount === 0 && tagSearch.globalCount > 0) {
                      event.preventDefault();
                      setTagSearchGlobal(true);
                    }
                  }}
                  placeholder={selectedTagIds.length > 0 ? `在「${scopeLabel}」及下级中过滤…` : "过滤标签…"}
                  aria-label="过滤标签"
                  className="input-frame mb-1 h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 text-[length:calc(12px*var(--ui-font-scale,1))] text-[var(--text-primary)] placeholder-[var(--text-placeholder)]"
                />
              )}
              {tagSearch.scope !== "all" && (
                <TagScopeNotice
                  scope={tagSearch.scope}
                  scopeLabel={scopeLabel}
                  subtreeCount={tagSearch.subtreeCount}
                  globalCount={tagSearch.globalCount}
                  onGlobal={() => setTagSearchGlobal(true)}
                  onSubtree={() => setTagSearchGlobal(false)}
                />
              )}
              {hierarchyEditing && (
                <div data-testid="tag-hierarchy-hint" className="mb-1 space-y-1">
                  <p className="px-1.5 text-[length:calc(12px*var(--ui-font-scale,1))] leading-5 text-[var(--text-muted)]">
                    拖到另一个标签上 = 加为它的下级（保留原父级，可多父）；按住 Alt 放下 = 从当前父级移过去。
                  </p>
                  <div
                    data-tag-root-drop=""
                    data-testid="tag-root-drop"
                    data-active={rootDrop ? (rootDrop.blocked ? "blocked" : "ok") : undefined}
                    title={rootDrop?.blocked ?? undefined}
                    className={`flex h-8 items-center justify-center rounded-[var(--radius-sm)] border border-dashed text-[length:calc(12px*var(--ui-font-scale,1))] ${
                      rootDrop
                        ? rootDrop.blocked
                          ? "border-[var(--color-danger-ink)] text-[var(--color-danger-ink)]"
                          : "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary-ink)]"
                        : "border-[var(--border-subtle)] text-[var(--text-faint)]"
                    }`}
                  >
                    {rootDrop?.blocked ?? "拖到这里：移出当前父级"}
                  </div>
                </div>
              )}
              <div className="mt-1 space-y-0.5">
                {visibleTagRows.map(({ tag, depth, hasChildren, parentId, pathKey }) => {
                  const active = selectedTagIds.includes(tag.id);
                  const excluded = excludedTagIds.includes(tag.id);
                  const collapsed = collapsedTagPaths.has(pathKey);
                  const canCollapse = hasChildren && !appliedTagQuery.trim();
                  const activeTagStyle = active
                    ? {
                        borderColor: "transparent",
                        backgroundColor: "var(--accent-primary-bg)",
                      }
                    : undefined;
                  return (
                    <div
                      key={pathKey}
                      className={`relative flex h-8 min-w-0 items-center gap-0.5 ${depth === 1 ? "ml-3" : depth === 2 ? "ml-6" : ""}`}
                    >
                      {tagInsert?.tagId === tag.id && <InsertLine after={tagInsert.after} />}
                      {parentDrop?.tagId === tag.id && (
                        <span
                          data-tag-parent-drop={parentDrop.blocked ? "blocked" : parentDrop.move ? "move" : "add"}
                          title={parentDrop.blocked ?? undefined}
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-0 rounded-[var(--radius-sm)] border-2 ${
                            parentDrop.blocked ? "border-[var(--color-danger-ink)]" : "border-[var(--accent-primary)]"
                          }`}
                        />
                      )}
                      {canCollapse ? (
                        <button
                          type="button"
                          aria-label={`${collapsed ? "展开" : "折叠"} ${tag.name}的下级标签`}
                          aria-expanded={!collapsed}
                          onClick={() => setCollapsedTagPaths((current) => {
                            const next = new Set(current);
                            if (next.has(pathKey)) next.delete(pathKey);
                            else next.add(pathKey);
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
                        data-tag-parent-id={parentId ?? ""}
                        aria-pressed={active}
                        aria-label={excluded ? `${tag.name}（已排除）` : undefined}
                        style={activeTagStyle}
                        onPointerDown={(event) => handleTagPointerDown(event, tag, parentId)}
                        onClick={(event) => handleTagClick(event, tag.id)}
                        title={activeDragKind ? undefined : hasChildren ? "单击筛选并包含下级标签；Alt+单击排除" : "单击筛选；Alt+单击排除"}
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
                        <span className={`min-w-0 flex-1 truncate text-[length:calc(13px*var(--ui-font-scale,1))] ${depth === 0 ? "font-medium" : "font-normal"} ${excluded ? "line-through" : ""}`}>{tag.name}</span>
                        <NavCount value={itemCountByTag.get(tag.id) ?? 0} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {tags.length === 0 && (
                <div className="mt-1 border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[length:calc(13px*var(--ui-font-scale,1))] leading-5 text-[var(--text-muted)]">
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
                {cabinetRows.map(({ cabinet, depth, hasChildren, collapsed }) => {
                  const active = selectedCabinetId === cabinet.id;
                  const hovered = hoveredCabinetId === cabinet.id;
                  const nestInto = cabinetInsert?.cabinetId === cabinet.id && cabinetInsert.into;
                  const activeCabinetStyle = active
                    ? { boxShadow: "inset 3px 0 0 var(--accent-primary)" }
                    : undefined;
                  return (
                    <div
                      key={cabinet.id}
                      className="relative flex items-center"
                      style={{ paddingLeft: depth * 14 }}
                      data-cabinet-depth={depth}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          className="icon-button h-6 w-5 shrink-0"
                          data-testid={`cabinet-toggle-${cabinet.id}`}
                          aria-label={collapsed ? `展开「${cabinet.name}」的子柜` : `折叠「${cabinet.name}」的子柜`}
                          aria-expanded={!collapsed}
                          onClick={() => toggleCabinetCollapsed(cabinet.id)}
                        >
                          {collapsed
                            ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                            : <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
                        </button>
                      ) : (
                        cabinets.some((entry) => entry.parent_id != null) && <span className="w-5 shrink-0" aria-hidden="true" />
                      )}
                    <button
                      type="button"
                      data-drop-item-cabinet-id={cabinet.id}
                      data-cabinet-parent-id={cabinet.parent_id ?? ""}
                      aria-pressed={active}
                      aria-expanded={hasChildren ? !collapsed : undefined}
                      style={activeCabinetStyle}
                      onPointerDown={(event) => handleCabinetPointerDown(event, cabinet)}
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
                        } else if (hasChildren && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
                          event.preventDefault();
                          toggleCabinetCollapsed(cabinet.id, event.key === "ArrowLeft");
                        }
                      }}
                      className={`relative flex h-8 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-left transition-colors active:cursor-grabbing ${
                        nestInto
                          ? // 拖入（作为子柜）：描边 + 浅底，选中行上也一眼可辨（单靠底色会和选中态混在一起）
                            "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)] text-[var(--accent-primary-ink)]"
                          : hovered
                          ? "border-transparent bg-[var(--accent-primary-bg-light)] text-[var(--accent-primary-ink)]"
                          : active
                            ? "border-transparent bg-[var(--accent-primary-bg)] font-semibold text-[var(--text-primary)]"
                            : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                      data-nest-target={nestInto ? "" : undefined}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px] ring-1 ring-[color-mix(in_srgb,var(--border-strong)_42%,transparent)]"
                        style={{ backgroundColor: cabinet.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-[length:calc(13px*var(--ui-font-scale,1))] font-medium">{cabinet.name}</span>
                      {cabinet.folder_path && <LinkedFolderMark cabinet={cabinet} />}
                      {cabinetInsert?.cabinetId === cabinet.id && !cabinetInsert.into && <InsertLine after={cabinetInsert.after} />}
                      <NavCount value={itemCountByCabinet.get(cabinet.id) ?? 0} />
                    </button>
                    </div>
                  );
                })}
              </div>

              {cabinets.length === 0 && (
                <div className="mt-1 border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[length:calc(13px*var(--ui-font-scale,1))] leading-5 text-[var(--text-muted)]">
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

      {((!sidebarHintDismissed && !activeDragKind) || activeDragKind === "item") && (
        <div
          data-region="sidebar-hint"
          className="flex h-8 shrink-0 items-center gap-2 px-3 text-[length:calc(12px*var(--ui-font-scale,1))] leading-4 text-[var(--text-muted)]"
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
          onAddChild={editingTag ? () => {
            setRelationsEditor({ initialTagId: editingTag.id });
            setEditingTag(null);
          } : undefined}
          onSave={async (name, color) => {
            if (editingTag) {
              await onUpdateTag(editingTag.id, name, color);
            } else {
              // 与对象标签对话框 / AI 打标同一口径：大小写不敏感复用既有标签，不再并存 Game/game（BUG-15）
              const existing = findTagByNameInsensitive(tags, name);
              if (existing) showToast(`标签「${existing.name}」已存在`, "info");
              else await onAddTag(name, color);
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
          folderPath={onSetCabinetFolder ? editingCabinet?.folder_path ?? null : undefined}
          parentId={onSetCabinetParent ? editingCabinet?.parent_id ?? null : undefined}
          parentOptions={parentCandidates(cabinets, editingCabinet?.id ?? null)
            .map((entry) => ({ id: entry.id, label: cabinetPathLabel(cabinets, entry.id) }))}
          hasChildren={editingCabinet ? cabinets.some((entry) => entry.parent_id === editingCabinet.id) : false}
          onSave={async (name, color, folder, parentId) => {
            if (editingCabinet) {
              await onUpdateCabinet(editingCabinet.id, name, color);
              // 先改父柜再关联文件夹：两者都由后端校验（关联柜只能是叶子）
              if (parentId !== undefined && parentId !== (editingCabinet.parent_id ?? null)) {
                await onSetCabinetParent?.(editingCabinet.id, parentId);
              }
              if (folder !== editingCabinet.folder_path) {
                await onSetCabinetFolder?.(editingCabinet.id, folder);
              }
            } else {
              const created = await onAddCabinet(name, color) as Cabinet;
              if (parentId != null) {
                await onSetCabinetParent?.(created.id, parentId).catch((err: unknown) =>
                  showToast(`文件柜已创建，但放入上级文件柜失败：${err instanceof Error ? err.message : String(err)}`, "error"),
                );
              }
              if (folder !== null) {
                // 柜已建成：关联失败只提示，不让用户重复提交造成重名
                await onSetCabinetFolder?.(created.id, folder).catch((err: unknown) =>
                  showToast(`文件柜已创建，但关联文件夹失败：${err instanceof Error ? err.message : String(err)}`, "error"),
                );
              }
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

      {relationsEditor && (
        <TagRelationsEditor
          initialTagId={relationsEditor.initialTagId}
          tags={tags}
          dataEpoch={dataEpoch}
          onAddRelation={onAddTagRelation}
          onRemoveRelation={onRemoveTagRelation}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onClose={() => setRelationsEditor(null)}
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
        <span className="data-readout text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">{count}</span>
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
    <span className={`min-w-6 shrink-0 text-right text-[length:calc(12px*var(--ui-font-scale,1))] tabular-nums text-[var(--text-muted)] ${value === 0 ? "opacity-40" : ""}`}>
      {value}
    </span>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-2 text-[length:calc(13px*var(--ui-font-scale,1))] font-medium text-[var(--text-tertiary)] hover:bg-[var(--accent-primary-bg-light)] hover:text-[var(--accent-primary)]"
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
      className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[length:calc(13px*var(--ui-font-scale,1))] font-medium transition-colors ${
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
      <span className="min-w-0 flex-1 truncate text-[length:calc(13px*var(--ui-font-scale,1))] font-medium">{title}</span>
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
          className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} aria-hidden="true" />
          )}
          <span className="truncate font-medium">{panel.title}</span>
        </button>
      ) : (
        <div className="flex h-8 items-center gap-2 px-2 text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-secondary)]">
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
        style={{ fontSize: "calc(var(--font-size-sm) * var(--ui-font-scale, 1))", display: collapsed ? "none" : undefined }}
      />
    </div>
  );
}

/** 关联文件夹的文件柜标记：悬停显示路径；磁盘未接入或文件夹不存在时附状态字样 */
function LinkedFolderMark({ cabinet }: { cabinet: Cabinet }) {
  const state = cabinet.folder_state === "offline" ? "离线" : cabinet.folder_state === "missing" ? "不存在" : null;
  const title = [`关联文件夹：${cabinet.folder_path}`, state && `（${state}）`, cabinet.folder_truncated && "（超过 50000 项，只同步了一部分）"]
    .filter(Boolean)
    .join("");
  return (
    <span title={title} className="flex shrink-0 items-center gap-1 text-[var(--text-faint)]">
      <FolderSync aria-label={title} size={13} strokeWidth={1.8} />
      {state && <span className="text-[length:calc(11px*var(--ui-font-scale,1))] text-[var(--color-warning-ink)]">{state}</span>}
    </span>
  );
}

/** 指针下最近的侧栏行，after 表示落在该行下半区 */
function sidebarRowAt(event: PointerEvent, selector: string): { element: HTMLElement; after: boolean; middle: boolean } | null {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const element = hit instanceof HTMLElement ? hit.closest<HTMLElement>(selector) : null;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  // middle：行高中间一半（用于文件柜「放进去成为子柜」）；上下各四分之一仍是排序
  return { element, after: offset > rect.height / 2, middle: offset > rect.height / 4 && offset < (rect.height * 3) / 4 };
}

const CABINET_COLLAPSE_KEY = "tl.sidebar.collapsedCabinets";

function loadCollapsedCabinets(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(CABINET_COLLAPSE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is number => typeof v === "number") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedCabinets(ids: Set<number>): void {
  try {
    localStorage.setItem(CABINET_COLLAPSE_KEY, JSON.stringify([...ids]));
  } catch {
    // 隐私模式等：折叠状态只在本次会话有效
  }
}

/** 拖动排序的插入位置线 */
function InsertLine({ after }: { after: boolean }) {
  return (
    <span
      data-sidebar-insert-line={after ? "after" : "before"}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-[var(--accent-primary)] ${after ? "-bottom-px" : "-top-px"}`}
    />
  );
}

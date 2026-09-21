import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp } from "lucide-react";
import type { ItemViewProps } from "../types";
import { useAppStore } from "../stores/appStore";
import { isHeaderSortActive, toggleHeaderSort, type ListHeaderColumn } from "../lib/itemQuery";
import { peekPendingItemFocus, focusSelectableItem, clearPendingItemFocus } from "../lib/workspaceChrome";
import { ITEM_LIST_BASE_ROW_HEIGHT, ITEM_LIST_GRID_TEMPLATE, ItemRow } from "./ItemRow";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { SelectionCanvas, consumeSelectionScrollFollow, type Rect } from "./SelectionCanvas";
import type { ContextSelectionInfo } from "./ItemCard";

type ItemRowViewProps = Omit<
  ItemViewProps,
  | "items"
  | "loading"
  | "onSetManyTags"
  | "onRemoveItemsFromCabinet"
  | "selectedItemIds"
  | "onSelectItems"
>;

/** 未选中行的稳定空选中集：避免选择数组每次换引用击穿所有可见行 memo */
const NO_SELECTION: number[] = [];

const ItemListRow = memo(function ItemListRow({
  item,
  viewProps,
  selected,
  contextSelection,
  selectedItemIds,
  active,
}: {
  item: ItemViewProps["items"][number];
  viewProps: ItemRowViewProps;
  selected: boolean;
  contextSelection: ContextSelectionInfo | null;
  selectedItemIds: number[];
  active: boolean;
}) {
  const {
    tags,
    cabinets,
    currentCabinetId,
    onLaunch,
    onSetTags,
    onRemoveTagFromItem,
    onAddNewTagToItem,
    onRecycleNewTags,
    onToggleFavorite,
    onSetFavorites,
    onAddItemToCabinet,
    onAddItemsToCabinet,
    onRemoveItemFromCabinet,
    onClearCurrentFilter,
    onClearCurrentFilters,
    onRequestRemoveFromApp,
    onRequestBatchRemoveFromApp,
    onUpdateThumbnail,
  } = viewProps;
  const handleLaunch = useCallback(() => onLaunch(item.id), [item.id, onLaunch]);
  const handleToggleFavorite = useCallback(() => { void onToggleFavorite(item.id).catch(() => {}); }, [item.id, onToggleFavorite]);
  // Explorer 语义：拖动已选中项 = 拖整个选中集；未选中项 = 只拖自己（useMemo 保引用稳定）
  const dragItemIds = useMemo(
    () => (selected && selectedItemIds.length > 1 ? selectedItemIds : [item.id]),
    [selected, selectedItemIds, item.id],
  );

  return (
    <ItemRow
      item={item}
      tags={tags}
      cabinets={cabinets}
      currentCabinetId={currentCabinetId}
      onLaunch={handleLaunch}
      onSetTags={onSetTags}
      onRemoveTagFromItem={onRemoveTagFromItem}
      onAddNewTagToItem={onAddNewTagToItem}
      onRecycleNewTags={onRecycleNewTags}
      onToggleFavorite={handleToggleFavorite}
      onSetFavorites={onSetFavorites}
      onAddItemToCabinet={onAddItemToCabinet}
      onAddItemsToCabinet={onAddItemsToCabinet}
      onRemoveItemFromCabinet={onRemoveItemFromCabinet}
      onClearCurrentFilter={onClearCurrentFilter}
      onClearCurrentFilters={onClearCurrentFilters}
      onRequestRemoveFromApp={onRequestRemoveFromApp}
      onRequestBatchRemoveFromApp={onRequestBatchRemoveFromApp}
      onUpdateThumbnail={onUpdateThumbnail}
      selected={selected}
      contextSelection={contextSelection}
      dragItemIds={dragItemIds}
      active={active}
    />
  );
});

/**
 * 可点击排序的表头单元格：点击切到该列排序，再点回到智能排序（对齐资源管理器习惯）。
 * 有搜索词时排序不套用（保留命中顺序），但设置仍生效——清空搜索后立即按所选排序。
 */
function SortableHeaderCell({
  column,
  label,
  align,
  className,
}: {
  column: ListHeaderColumn;
  label: string;
  align?: "right";
  /** 追加到单元格按钮上的布局类（如与行内容对齐用的左内边距） */
  className?: string;
}) {
  const sortMode = useAppStore((state) => state.sortMode);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const active = isHeaderSortActive(sortMode, column);

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setSortMode(toggleHeaderSort(sortMode, column))}
      title={active ? "再点一次回到智能排序" : `按${label}排序`}
      className={`group inline-flex h-8 items-center gap-1 text-[13px] font-semibold transition-colors ${
        align === "right" ? "justify-end text-right" : "text-left"
      } ${active ? "text-[var(--accent-primary)]" : "text-[var(--text-faint)] hover:text-[var(--text-secondary)]"} ${className ?? ""}`}
    >
      {label}
      <ArrowUp
        className={`h-3 w-3 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}

export function ItemListView({
  items,
  tags,
  cabinets,
  loading,
  currentCabinetId,
  onLaunch,
  onSetTags,
  onRemoveTagFromItem,
  onAddNewTagToItem,
  onRecycleNewTags,
  onToggleFavorite,
  onSetFavorites,
  onAddItemToCabinet,
  onAddItemsToCabinet,
  onRemoveItemFromCabinet,
  onClearCurrentFilter,
  onClearCurrentFilters,
  onRequestRemoveFromApp,
  onRequestBatchRemoveFromApp,
  onUpdateThumbnail,
  selectedItemIds,
  onSelectItems,
  libraryEmpty,
  onClearFilters,
  onAddItems,
  onRefreshWorkspace,
}: ItemViewProps) {
  const viewProps = useMemo(() => ({
    tags,
    cabinets,
    currentCabinetId,
    onLaunch,
    onSetTags,
    onRemoveTagFromItem,
    onAddNewTagToItem,
    onRecycleNewTags,
    onToggleFavorite,
    onSetFavorites,
    onAddItemToCabinet,
    onAddItemsToCabinet,
    onRemoveItemFromCabinet,
    onClearCurrentFilter,
    onClearCurrentFilters,
    onRequestRemoveFromApp,
    onRequestBatchRemoveFromApp,
    onUpdateThumbnail,
  }), [
    tags,
    cabinets,
    currentCabinetId,
    onLaunch,
    onSetTags,
    onRemoveTagFromItem,
    onAddNewTagToItem,
    onRecycleNewTags,
    onToggleFavorite,
    onSetFavorites,
    onAddItemToCabinet,
    onAddItemsToCabinet,
    onRemoveItemFromCabinet,
    onClearCurrentFilter,
    onClearCurrentFilters,
    onRequestRemoveFromApp,
    onRequestBatchRemoveFromApp,
    onUpdateThumbnail,
  ]);

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowMetricsRef = useRef<Map<number, { start: number; size: number }>>(new Map());

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_LIST_BASE_ROW_HEIGHT,
    // 行 key 用对象 id 而非默认行索引：筛选/排序/换柜后行 key 变化触发 React
    // 重建行 DOM 并由 measureElement 同步重测；索引复用会让旧行高残留在
    // itemSizeCache（v3 同步测量命中缓存即不读 DOM），表现为行距错乱。
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 6,
  });

  // 记录可见行真实测量数据；缺失行用 estimateSize 估算。
  // 注意：写 ref 属于副作用，必须放在 useLayoutEffect 中（渲染期写入在并发渲染被丢弃时会残留脏数据）。
  const virtualItems = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    for (const vRow of virtualItems) {
      rowMetricsRef.current.set(vRow.index, { start: vRow.start, size: vRow.size });
    }
  }, [virtualItems]);

  // items 变化后同一行索引对应的内容已失效，框选度量按行索引记录，须清空重录。
  // 行高重测无需 virtualizer.measure()：getItemKey 按对象 id 变化触发
  // measureElement 重测；同 id 行的纯高度变化（多行标签/Mod footer）由虚拟器
  // 内部 ResizeObserver 自动校正（measure() 清缓存后复用行不会重测，见 ItemGrid）。
  useLayoutEffect(() => {
    rowMetricsRef.current.clear();
  }, [items]);

  const lastSelectedId = selectedItemIds[selectedItemIds.length - 1];

  // 活动项（roving focus）：选中集末尾；pending 焦点在行挂载后消费
  const activeId = lastSelectedId ?? null;
  const activeMounted = useMemo(() => {
    if (activeId == null) return false;
    const idx = items.findIndex((item) => item.id === activeId);
    if (idx < 0) return false;
    return virtualItems.some((v) => v.index === idx);
  }, [activeId, items, virtualItems]);

  useEffect(() => {
    const pending = peekPendingItemFocus();
    if (pending == null) return;
    if (focusSelectableItem(pending)) clearPendingItemFocus();
  }, [virtualItems]);

  // 焦点回补：活动项随虚拟化卸载导致焦点掉到 body 时退回容器
  useEffect(() => {
    if (activeMounted) return;
    if (document.activeElement !== document.body) return;
    scrollRef.current?.focus({ preventScroll: true });
  }, [activeMounted]);

  const skipScrollRef = useRef(true);
  const lastScrolledIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      lastScrolledIdRef.current = lastSelectedId ?? null;
      return;
    }
    if (lastSelectedId == null) {
      lastScrolledIdRef.current = null;
      return;
    }
    if (lastScrolledIdRef.current === lastSelectedId) return;
    lastScrolledIdRef.current = lastSelectedId;
    // 仅键盘单步导航（方向键/Home/End/Shift 扩展）跟随滚动；Ctrl+A 全选、
    // 框选、批量选择不设置跟随标记，视图保持原地（SelectionCanvas 顶部有标记说明）。
    if (consumeSelectionScrollFollow() !== lastSelectedId) return;
    const index = items.findIndex((item) => item.id === lastSelectedId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [lastSelectedId, items, virtualizer]);

  // 右键命中多选集时，右键菜单的删除/收藏/复制路径作用于整个选中集；
  // 仅多选（>1）时构造，单选/未选中为 null（菜单回退单对象语义）。
  const contextSelectionInfo = useMemo<ContextSelectionInfo | null>(() => {
    if (selectedItemIds.length <= 1) return null;
    const idSet = new Set(selectedItemIds);
    const selected = items.filter((item) => idSet.has(item.id));
    return {
      ids: selected.map((item) => item.id),
      paths: selected.map((item) => item.path),
      favoriteTarget: selected.some((item) => !item.is_favorite),
    };
  }, [items, selectedItemIds]);

  // 基于虚拟化器测量数据返回每个 item 在滚动容器内容坐标系中的矩形。
  // 注意：vRow.start 相对于行容器（position:relative 的 div），而行容器位于 sticky
  // 表头之下，因此必须用行容器的实际 DOM 位置校正，否则框选矩形整体上移一个表头高度。
  const rowContainerRef = useRef<HTMLDivElement>(null);
  const getItemRects = useCallback((): Map<number, Rect> => {
    const container = scrollRef.current;
    if (!container) return new Map();

    // 行容器在滚动容器内容坐标系中的实际偏移（含表头高度、surface-card 边框等）
    const rowContainer = rowContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const baseLeft = rowContainer
      ? rowContainer.getBoundingClientRect().left - containerRect.left + container.scrollLeft
      : 0;
    const baseTop = rowContainer
      ? rowContainer.getBoundingClientRect().top - containerRect.top + container.scrollTop
      : 0;
    const contentWidth = rowContainer?.clientWidth ?? container.clientWidth;

    const map = new Map<number, Rect>();
    for (let index = 0; index < items.length; index++) {
      const metric = rowMetricsRef.current.get(index);
      const start = metric?.start ?? index * ITEM_LIST_BASE_ROW_HEIGHT;
      const size = metric?.size ?? ITEM_LIST_BASE_ROW_HEIGHT;
      map.set(items[index].id, {
        left: baseLeft,
        top: baseTop + start,
        right: baseLeft + contentWidth,
        bottom: baseTop + start + size,
      });
    }
    return map;
  }, [items]);

  if (loading) {
    return <WorkspaceSkeleton view="list" />;
  }

  if (items.length === 0) {
    // 空态也挂在 SelectionCanvas 里：空白右键背景菜单（添加文件/刷新）在空库/空筛选时同样可用
    return (
      <SelectionCanvas
        dataRegion="item-list"
        className="flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        itemIds={itemIds}
        selectedItemIds={selectedItemIds}
        onSelectItems={onSelectItems}
        scrollElementRef={scrollRef}
        onAddItems={onAddItems}
        onRefreshWorkspace={onRefreshWorkspace}
        containerTabIndex={0}
      >
        <WorkspaceEmptyState kind={libraryEmpty ? "library" : "filter"} onClearFilters={onClearFilters} onAddItems={onAddItems} />
      </SelectionCanvas>
    );
  }

  return (
    <SelectionCanvas
      dataRegion="item-list"
      // scrollbar-gutter 恒留滚动槽：列表可滚动与否一眼可辨，避免末项被裁的错觉
      className="flex-1 overflow-y-auto [scrollbar-gutter:stable]"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={getItemRects}
      onAddItems={onAddItems}
      onRefreshWorkspace={onRefreshWorkspace}
      containerTabIndex={activeMounted ? -1 : 0}
    >
      {/* 全幅表格（对标资源管理器详细信息视图）：表头吸附、整行分隔线，无外层卡片 */}
      <div>
        <div
          className="sticky top-0 z-10 grid h-9 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4"
          style={{ gridTemplateColumns: ITEM_LIST_GRID_TEMPLATE }}
        >
          <span aria-hidden="true" />
          {/* 名称列表头与行内名称文本对齐（让过 36px 图标 + 10px 间距） */}
          <SortableHeaderCell column="name" label="名称" className="pl-[46px]" />
          <span className="instrument-label">标签</span>
          <SortableHeaderCell column="type" label="类型" align="right" />
        </div>

        {/* 虚拟化列表：position:relative 撑开滚动高度；行用 top 定位（非 transform，
            否则会令行内右键菜单等 position:fixed 元素错位），高度由 measureElement 动态测量。 */}
        <div ref={rowContainerRef} role="list" aria-label="项目列表" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const item = items[vRow.index]!;
            const isSelected = selectedItemIdSet.has(item.id);
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                role="presentation"
                style={{
                  position: "absolute",
                  top: vRow.start,
                  left: 0,
                  right: 0,
                }}
              >
                <ItemListRow
                  item={item}
                  viewProps={viewProps}
                  selected={isSelected}
                  contextSelection={isSelected ? contextSelectionInfo : null}
                  selectedItemIds={isSelected ? selectedItemIds : NO_SELECTION}
                  active={item.id === activeId}
                />
              </div>
            );
          })}
        </div>
      </div>
    </SelectionCanvas>
  );
}

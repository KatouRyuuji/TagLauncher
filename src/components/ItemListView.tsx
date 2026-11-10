import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ItemViewProps, ItemWithTags } from "../types";
import { ItemPlaceholder, useLoadedRowHeight } from "./ItemPlaceholder";
import { useAppStore } from "../stores/appStore";
import { scaledRowEstimate } from "../lib/uiFontScale";
import { isHeaderSortActive, isHeaderSortDesc, toggleHeaderSort, type ListHeaderColumn } from "../lib/itemQuery";
import { peekPendingItemFocus, focusSelectableItem, clearPendingItemFocus } from "../lib/workspaceChrome";
import { ITEM_LIST_BASE_ROW_HEIGHT, ITEM_LIST_COMPACT_ROW_HEIGHT, ITEM_LIST_GRID_TEMPLATE, ItemRow } from "./ItemRow";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { SelectionCanvas, consumeSelectionScrollFollow, type Rect } from "./SelectionCanvas";
import type { ContextSelectionInfo } from "./ItemCard";

type ItemRowViewProps = Omit<
  ItemViewProps,
  | "view"
  | "contextSelection"
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
  item: ItemWithTags;
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
 * 可点击排序的表头单元格：名称列循环 升序 → 降序 → 智能，类型列 类型 ↔ 智能
 * （对齐资源管理器习惯），箭头方向即升降序。
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
  const desc = isHeaderSortDesc(sortMode, column);
  const Arrow = desc ? ArrowDown : ArrowUp;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setSortMode(toggleHeaderSort(sortMode, column))}
      title={
        column === "name"
          ? sortMode === "name"
            ? "再点一次按名称降序"
            : sortMode === "name-desc"
              ? "再点一次回到智能排序"
              : "按名称升序"
          : active
            ? "再点一次回到智能排序"
            : `按${label}排序`
      }
      className={`group inline-flex h-8 items-center gap-1 text-[length:calc(13px*var(--ui-font-scale,1))] font-semibold transition-colors ${
        align === "right" ? "justify-end text-right" : "text-left"
      } ${active ? "text-[var(--accent-primary)]" : "text-[var(--text-faint)] hover:text-[var(--text-secondary)]"} ${className ?? ""}`}
    >
      {label}
      <Arrow
        className={`h-3 w-3 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}

export function ItemListView({
  view,
  contextSelection: contextSelectionInfo = null,
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
  const ids = view.ids;
  const count = ids.length;
  const itemIds = ids;
  const listDensity = useAppStore((state) => state.listDensity);
  const uiFontScale = useAppStore((state) => state.uiFontScale);
  // 字号放大会撑高行：估计值同步放大；真实行高仍由 measureElement + ResizeObserver 测量（F03）
  const rowHeightEstimate = scaledRowEstimate(
    listDensity === "compact" ? ITEM_LIST_COMPACT_ROW_HEIGHT : ITEM_LIST_BASE_ROW_HEIGHT,
    uiFontScale,
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowMetricsRef = useRef<Map<number, { start: number; size: number }>>(new Map());

  const loadedRowHeight = useLoadedRowHeight(scrollRef, rowHeightEstimate);
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    // 未测量行按已加载行的真实行高估算（见 useLoadedRowHeight）
    estimateSize: () => loadedRowHeight,
    // 行 key 用对象 id 而非默认行索引：筛选/排序/换柜后行 key 变化触发 React
    // 重建行 DOM 并由 measureElement 同步重测；索引复用会让旧行高残留在
    // itemSizeCache（v3 同步测量命中缓存即不读 DOM），表现为行距错乱。
    getItemKey: (index) => ids[index] ?? index,
    overscan: 6,
    // 滚动回调里就发起取页（不等 React 提交后的 effect），跳转时省掉一轮渲染
    onChange: (instance) => {
      const rows = instance.getVirtualIndexes();
      if (rows.length > 0) viewRef.current.ensureRange(rows[0], rows[rows.length - 1] + 1);
    },
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
  // 密度切换同理：行高经 estimateSize + ResizeObserver 重测收敛。
  useLayoutEffect(() => {
    rowMetricsRef.current.clear();
  }, [ids]);

  // 按可视行区间取页（首屏 + 滚动/跳转按需；已缓存的页不重取，过期页重取）
  const firstRow = virtualItems[0]?.index ?? 0;
  const lastRow = virtualItems[virtualItems.length - 1]?.index ?? -1;
  useEffect(() => {
    if (lastRow >= firstRow) view.ensureRange(firstRow, lastRow + 1);
  }, [view, firstRow, lastRow]);

  const lastSelectedId = selectedItemIds[selectedItemIds.length - 1];

  // 活动项（roving focus）：选中集末尾；pending 焦点在行挂载后消费
  const activeId = lastSelectedId ?? null;
  const activeMounted = useMemo(() => {
    if (activeId == null) return false;
    const idx = view.indexOf(activeId);
    if (idx < 0) return false;
    return virtualItems.some((v) => v.index === idx);
  }, [activeId, view, virtualItems]);

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
    const index = view.indexOf(lastSelectedId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [lastSelectedId, view, virtualizer]);

  // 右键命中多选集时的 contextSelection 由 App 按 ID 取齐对象后统一给出（选中集可能含未缓存对象）。

  // 基于虚拟化器测量数据返回每个 item 在滚动容器内容坐标系中的矩形。
  // 注意：vRow.start 相对于行容器（position:relative 的 div），而行容器位于 sticky
  // 表头之下，因此必须用行容器的实际 DOM 位置校正，否则框选矩形整体上移一个表头高度。
  const rowContainerRef = useRef<HTMLDivElement>(null);
  const getItemRects = useCallback((band?: { top: number; bottom: number }): Map<number, Rect> => {
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
    for (let index = 0; index < count; index++) {
      const metric = rowMetricsRef.current.get(index);
      const start = metric?.start ?? index * rowHeightEstimate;
      const size = metric?.size ?? rowHeightEstimate;
      const top = baseTop + start;
      const bottom = top + size;
      if (band && (bottom < band.top || top > band.bottom)) continue;
      map.set(ids[index], {
        left: baseLeft,
        top: baseTop + start,
        right: baseLeft + contentWidth,
        bottom: baseTop + start + size,
      });
    }
    return map;
  }, [ids, count, rowHeightEstimate]);

  if (loading) {
    return <WorkspaceSkeleton view="list" />;
  }

  if (count === 0) {
    // 空态也挂在 SelectionCanvas 里：空白右键背景菜单（添加文件/刷新）在空库/空筛选时同样可用
    return (
      <SelectionCanvas
        dataRegion="item-list"
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
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
      className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={getItemRects}
      onAddItems={onAddItems}
      onRefreshWorkspace={onRefreshWorkspace}
      containerTabIndex={activeMounted ? -1 : 0}
    >
      {/* 全幅表格：表头吸附，行靠间距与悬停态区分，无外层卡片 */}
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
        <div ref={rowContainerRef} role="list" aria-label="项目列表" style={{ height: virtualizer.getTotalSize() + 12, position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const item = view.at(vRow.index);
            if (!item) {
              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  role="presentation"
                  style={{ position: "absolute", top: vRow.start, left: 0, right: 0 }}
                >
                  <ItemPlaceholder height={loadedRowHeight} />
                </div>
              );
            }
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

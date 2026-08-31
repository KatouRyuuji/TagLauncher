import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp } from "lucide-react";
import type { ItemViewProps } from "../types";
import { useAppStore } from "../stores/appStore";
import { isHeaderSortActive, toggleHeaderSort, type ListHeaderColumn } from "../lib/itemQuery";
import { ITEM_LIST_BASE_ROW_HEIGHT, ITEM_LIST_GRID_TEMPLATE, ItemRow } from "./ItemRow";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { SelectionCanvas, type Rect } from "./SelectionCanvas";

type ItemRowViewProps = Omit<
  ItemViewProps,
  | "items"
  | "loading"
  | "onSetManyTags"
  | "onAddItemsToCabinet"
  | "onRemoveItemsFromCabinet"
  | "selectedItemIds"
  | "onSelectItems"
>;

const ItemListRow = memo(function ItemListRow({
  item,
  viewProps,
  selected,
}: {
  item: ItemViewProps["items"][number];
  viewProps: ItemRowViewProps;
  selected: boolean;
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
    onAddItemToCabinet,
    onRemoveItemFromCabinet,
    onClearCurrentFilter,
    onRequestRemoveFromApp,
    onUpdateThumbnail,
  } = viewProps;
  const handleLaunch = useCallback(() => onLaunch(item.id), [item.id, onLaunch]);
  const handleToggleFavorite = useCallback(() => { void onToggleFavorite(item.id).catch(() => {}); }, [item.id, onToggleFavorite]);

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
      onAddItemToCabinet={onAddItemToCabinet}
      onRemoveItemFromCabinet={onRemoveItemFromCabinet}
      onClearCurrentFilter={onClearCurrentFilter}
      onRequestRemoveFromApp={onRequestRemoveFromApp}
      onUpdateThumbnail={onUpdateThumbnail}
      selected={selected}
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
}: {
  column: ListHeaderColumn;
  label: string;
  align?: "right";
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
      className={`group inline-flex h-8 items-center gap-1 text-[10px] font-semibold transition-colors ${
        align === "right" ? "justify-end text-right" : "text-left"
      } ${active ? "text-[var(--accent-primary)]" : "text-[var(--text-faint)] hover:text-[var(--text-secondary)]"}`}
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
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onClearCurrentFilter,
  onRequestRemoveFromApp,
  onUpdateThumbnail,
  selectedItemIds,
  onSelectItems,
  libraryEmpty,
  onClearFilters,
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
    onAddItemToCabinet,
    onRemoveItemFromCabinet,
    onClearCurrentFilter,
    onRequestRemoveFromApp,
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
    onAddItemToCabinet,
    onRemoveItemFromCabinet,
    onClearCurrentFilter,
    onRequestRemoveFromApp,
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

  // items 变化后同一行索引对应的内容/高度已失效，但虚拟化器按索引缓存测量值、
  // 且 key 相同不会重新触发 measureElement：必须主动清空测量缓存强制重测，
  // 否则滚动总高度与行位置按旧高度计算（滚动错乱、未渲染区域尺寸错误）。
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, items]);

  const lastSelectedId = selectedItemIds[selectedItemIds.length - 1];
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
    const index = items.findIndex((item) => item.id === lastSelectedId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [lastSelectedId, items, virtualizer]);

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
    return <WorkspaceEmptyState kind={libraryEmpty ? "library" : "filter"} onClearFilters={onClearFilters} />;
  }

  return (
    <SelectionCanvas
      dataRegion="item-list"
      className="flex-1 overflow-y-auto p-4"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={getItemRects}
    >
      <div className="workbench-panel overflow-hidden">
        <div
          className="sticky top-0 z-10 grid min-h-9 items-center gap-3 border-b border-[var(--line-hairline)] bg-[color-mix(in_srgb,var(--surface-raised)_96%,transparent)] px-3 backdrop-blur-sm"
          style={{ gridTemplateColumns: ITEM_LIST_GRID_TEMPLATE }}
        >
          <span aria-hidden="true" />
          <SortableHeaderCell column="name" label="名称" />
          <span className="instrument-label">标签</span>
          <SortableHeaderCell column="type" label="类型" align="right" />
        </div>

        {/* 虚拟化列表：position:relative 撑开滚动高度；行用 top 定位（非 transform，
            否则会令行内右键菜单等 position:fixed 元素错位），高度由 measureElement 动态测量。 */}
        <div ref={rowContainerRef} role="list" aria-label="对象列表" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const item = items[vRow.index]!;
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
                  selected={selectedItemIdSet.has(item.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </SelectionCanvas>
  );
}

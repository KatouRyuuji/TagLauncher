import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ItemViewProps } from "../types";
import { ItemRow } from "./ItemRow";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { SelectionCanvas, type Rect } from "./SelectionCanvas";

/** 列表行初始估算高度（py-3 × 2 + icon 44px ≈ 68px）；真实高度由 measureElement 动态校正 */
const LIST_ROW_HEIGHT = 68;

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
    onAddTagToItem,
    onRemoveTagFromItem,
    onAddNewTagToItem,
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
      onAddTagToItem={onAddTagToItem}
      onRemoveTagFromItem={onRemoveTagFromItem}
      onAddNewTagToItem={onAddNewTagToItem}
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

export function ItemListView({
  items,
  tags,
  cabinets,
  loading,
  currentCabinetId,
  onLaunch,
  onSetTags,
  onAddTagToItem,
  onRemoveTagFromItem,
  onAddNewTagToItem,
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
    onAddTagToItem,
    onRemoveTagFromItem,
    onAddNewTagToItem,
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
    onAddTagToItem,
    onRemoveTagFromItem,
    onAddNewTagToItem,
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
    estimateSize: () => LIST_ROW_HEIGHT,
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
  useEffect(() => {
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    if (lastSelectedId == null) return;
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
      const start = metric?.start ?? index * LIST_ROW_HEIGHT;
      const size = metric?.size ?? LIST_ROW_HEIGHT;
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
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="surface-card flex items-center gap-3 px-5 py-4 text-sm text-[var(--text-muted)]">
          <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-[var(--accent-primary)]" />
          正在加载项目数据...
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return <WorkspaceEmptyState kind={libraryEmpty ? "library" : "filter"} onClearFilters={onClearFilters} />;
  }

  return (
    <SelectionCanvas
      dataRegion="item-list"
      className="flex-1 overflow-y-auto px-5 py-5"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={getItemRects}
    >
      <div className="surface-card overflow-hidden">
        <div className="sticky top-0 z-10 grid grid-cols-[56px_minmax(0,1fr)_minmax(180px,300px)_112px] items-center gap-4 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_96%,transparent)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
          <span />
          <span>名称</span>
          <span>标签</span>
          <span className="text-right">类型</span>
        </div>

        {/* 虚拟化列表：position:relative 撑开滚动高度；行用 top 定位（非 transform，
            否则会令行内右键菜单等 position:fixed 元素错位），高度由 measureElement 动态测量。 */}
        <div ref={rowContainerRef} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const item = items[vRow.index]!;
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
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

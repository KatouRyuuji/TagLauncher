import type { ItemViewProps } from "../types";
import { ItemCard } from "./ItemCard";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { SelectionCanvas, type Rect } from "./SelectionCanvas";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { gridOverscanRows, setWorkspaceGridLanes } from "../lib/workspaceChrome";

/** 网格参数：与 index.css --grid-col-min + gap-4 对齐 */
const GRID_COL_MIN = 238;
const GRID_GAP = 16;
/** 卡片行初始估算高度（含 gap）；真实高度由 measureElement 动态校正，避免标签裁剪 */
const GRID_ROW_EST = 188;

/** 首帧前的列数粗估，避免 lanes=1 闪烁（useLayoutEffect 会立即精确校正） */
function estimateInitialLanes(): number {
  if (typeof window === "undefined") return 4;
  const approxContent = Math.max(320, window.innerWidth - 300);
  return Math.max(1, Math.floor((approxContent + GRID_GAP) / (GRID_COL_MIN + GRID_GAP)));
}

type ItemCardViewProps = Omit<
  ItemViewProps,
  | "items"
  | "loading"
  | "onSetManyTags"
  | "onAddItemsToCabinet"
  | "onRemoveItemsFromCabinet"
  | "selectedItemIds"
  | "onSelectItems"
>;

const ItemGridCard = memo(function ItemGridCard({
  item,
  viewProps,
  selected,
}: {
  item: ItemViewProps["items"][number];
  viewProps: ItemCardViewProps;
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
    <ItemCard
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

export function ItemGrid({
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
  const [lanes, setLanes] = useState(estimateInitialLanes);
  const rowCount = Math.ceil(items.length / Math.max(1, lanes));

  // 记录每一行的虚拟化测量位置与高度；缺失行用 estimate 估算。
  const rowMetricsRef = useRef<Map<number, { start: number; size: number }>>(new Map());

  const computeLanes = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const w = el.clientWidth - 40; // 扣除 px-5 左右内边距
    const next = Math.max(1, Math.floor((w + GRID_GAP) / (GRID_COL_MIN + GRID_GAP)));
    setLanes((prev) => (prev === next ? prev : next));
  }, []);

  // 首帧同步精确测量列数（在浏览器绘制前），消除卡片"全宽闪烁"
  useLayoutEffect(() => {
    computeLanes();
  }, [computeLanes]);

  // 容器宽度变化时动态更新列数
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => computeLanes());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeLanes]);

  useEffect(() => {
    setWorkspaceGridLanes(lanes);
    return () => setWorkspaceGridLanes(1);
  }, [lanes]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_EST,
    // 列数自适应 overscan：一行卡片越多预渲染越贵，行数相应减少
    overscan: gridOverscanRows(lanes),
  });

  // 每次渲染把可见行的真实测量数据记录下来，供 getItemRects 使用。
  // 注意：写 ref 属于副作用，必须放在 useLayoutEffect 中（渲染期写入在并发渲染被丢弃时会残留脏数据）。
  const virtualItems = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    for (const vRow of virtualItems) {
      rowMetricsRef.current.set(vRow.index, { start: vRow.start, size: vRow.size });
    }
  }, [virtualItems]);

  // lanes 变化后行数重排，旧行索引的度量对应到错误的行，清空等待重新测量，避免框选短暂错位
  useLayoutEffect(() => {
    rowMetricsRef.current.clear();
  }, [lanes]);

  // lanes/items 变化后，同一行索引对应的内容与高度已失效，但虚拟化器按索引缓存测量值、
  // 且 key 相同不会重新触发 measureElement：必须主动清空测量缓存强制重测，
  // 否则滚动总高度与行位置按旧高度计算，出现滚动条长度不符、快速滚动空白/跳变。
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, lanes, items]);

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
    virtualizer.scrollToIndex(Math.floor(index / Math.max(1, lanes)), { align: "auto" });
  }, [lastSelectedId, items, lanes, virtualizer]);

  // 基于虚拟化器测量数据返回每个 item 在滚动容器内容坐标系中的矩形。
  // 已渲染行使用真实测量值，未渲染行用 estimateSize 估算，从而支持跨屏框选。
  // 注意：此 Hook 必须位于所有条件返回之前，否则违反 Rules of Hooks。
  const getItemRects = useCallback((): Map<number, Rect> => {
    const container = scrollRef.current;
    if (!container) return new Map();

    const style = getComputedStyle(container);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const contentWidth = container.clientWidth - paddingLeft - paddingRight;
    const colWidth = (contentWidth - (lanes - 1) * GRID_GAP) / lanes;

    const map = new Map<number, Rect>();
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const metric = rowMetricsRef.current.get(rowIndex);
      const rowStart = metric?.start ?? rowIndex * GRID_ROW_EST;
      const rowSize = metric?.size ?? GRID_ROW_EST;

      for (let colIndex = 0; colIndex < lanes; colIndex++) {
        const itemIndex = rowIndex * lanes + colIndex;
        if (itemIndex >= items.length) break;
        const left = paddingLeft + colIndex * (colWidth + GRID_GAP);
        const right = left + colWidth;
        const top = paddingTop + rowStart;
        const bottom = top + rowSize - GRID_GAP; // 行间距不算入卡片
        map.set(items[itemIndex].id, { left, top, right, bottom });
      }
    }
    return map;
  }, [lanes, rowCount, items]);

  if (loading) {
    return <WorkspaceSkeleton view="grid" />;
  }

  if (items.length === 0) {
    return <WorkspaceEmptyState kind={libraryEmpty ? "library" : "filter"} onClearFilters={onClearFilters} />;
  }

  return (
    <SelectionCanvas
      dataRegion="item-grid"
      className="flex-1 overflow-y-auto px-5 py-5"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={getItemRects}
    >
      {/* 虚拟化网格：position:relative 撑开滚动高度，每行绝对定位 */}
      <div
        data-region="item-grid-inner"
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const startIdx = vRow.index * lanes;
          const rowItems = items.slice(startIdx, Math.min(startIdx + lanes, items.length));
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                // 用 top 而非 transform 定位：transform 会创建新的定位上下文，
                // 导致卡片右键菜单等 position:fixed 元素错位。
                position: "absolute",
                top: vRow.start,
                left: 0,
                right: 0,
                // 不设固定 height：行高由 measureElement 按卡片实际内容动态测量，
                // 标签较多的卡片不再被裁剪。paddingBottom 充当行间距。
                paddingBottom: GRID_GAP,
                display: "grid",
                gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`,
                gap: GRID_GAP,
              }}
            >
              {rowItems.map((item) => (
                <ItemGridCard
                  key={item.id}
                  item={item}
                  viewProps={viewProps}
                  selected={selectedItemIdSet.has(item.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </SelectionCanvas>
  );
}

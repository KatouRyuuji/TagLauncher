import type { ItemViewProps } from "../types";
import { ItemCard } from "./ItemCard";
import { SelectionCanvas, type Rect } from "./SelectionCanvas";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

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

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_EST,
    overscan: 3,
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
    return (
      <div className="flex-1 overflow-auto">
        <div className="empty-state-panel">
          <div className="flex h-16 w-16 items-center justify-center rounded-[calc(var(--radius-xl)+4px)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.75A2.75 2.75 0 0 1 6.75 5h3.4a1.5 1.5 0 0 1 1.06.44l1.35 1.35c.28.28.66.44 1.06.44h3.63A2.75 2.75 0 0 1 20 10v6.25A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25V7.75Z" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">暂无项目</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              将文件或文件夹拖拽到主区域，或使用顶部按钮开始导入。
            </p>
          </div>
        </div>
      </div>
    );
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

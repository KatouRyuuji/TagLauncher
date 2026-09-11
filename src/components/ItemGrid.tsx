import type { ItemViewProps } from "../types";
import { ItemCard } from "./ItemCard";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { SelectionCanvas, consumeSelectionScrollFollow, type Rect } from "./SelectionCanvas";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { gridOverscanRows, setWorkspaceGridLanes } from "../lib/workspaceChrome";
import type { ContextSelectionInfo } from "./ItemCard";

/** 网格行间距（12px），与骨架屏的 gap-3 保持一致。 */
const GRID_GAP = 12;
/** 卡片行初始估算高度（含 gap）；真实高度由 measureElement 动态校正，避免标签裁剪 */
const GRID_ROW_EST = 200;

/**
 * 行高测量：始终读取真实 DOM 高度（ResizeObserver 回调用 borderBoxSize 保留亚像素精度，
 * 挂载 ref 分支读 offsetHeight）。v3 默认实现的无 entry 分支在 itemSizeCache 命中时
 * 直接返回缓存值而不读 DOM；实测列数/筛选切换的过渡帧中，旧世代行的中间尺寸会被
 * ResizeObserver 写入新世代的 key（缓存串代），命中脏缓存的行将按错误高度定位，
 * 直到下一次尺寸变化才校正。挂载即真测使已渲染行的行高恒等于真实 DOM 高度，
 * 与缓存内容无关；未渲染行仍由 itemSizeCache/估算值服务。
 */
function measureGridRow(element: HTMLElement, entry: ResizeObserverEntry | undefined): number {
  const box = entry?.borderBoxSize?.[0];
  if (box) return Math.round(box.blockSize);
  return element.offsetHeight;
}

/**
 * 列最小宽度：唯一来源是 index.css --grid-col-min（主题可覆盖，骨架屏按它渲染），
 * JS 侧读取同一变量保证真实网格与骨架屏一致；读取失败回退 256。
 * 注意：主题运行时切换该变量不会触发 lanes 重算（resize 才会），内置主题均为 256，可接受。
 */
const FALLBACK_COL_MIN = 256;
function gridColMin(): number {
  if (typeof window === "undefined") return FALLBACK_COL_MIN;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--grid-col-min").trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_COL_MIN;
}

/** 首帧前的列数粗估，避免 lanes=1 闪烁（useLayoutEffect 会立即精确校正） */
function estimateInitialLanes(): number {
  if (typeof window === "undefined") return 4;
  const approxContent = Math.max(320, window.innerWidth - 300);
  return Math.max(1, Math.floor((approxContent + GRID_GAP) / (gridColMin() + GRID_GAP)));
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
  contextSelection,
}: {
  item: ItemViewProps["items"][number];
  viewProps: ItemCardViewProps;
  selected: boolean;
  contextSelection: ContextSelectionInfo | null;
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
    <ItemCard
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
      contextSelection={contextSelection}
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
  onAddItems,
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
  const [lanes, setLanes] = useState(estimateInitialLanes);
  const rowCount = Math.ceil(items.length / Math.max(1, lanes));

  // 记录每一行的虚拟化测量位置与高度；缺失行用 estimate 估算。
  const rowMetricsRef = useRef<Map<number, { start: number; size: number }>>(new Map());

  const computeLanes = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const w = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const next = Math.max(1, Math.floor((w + GRID_GAP) / (gridColMin() + GRID_GAP)));
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
    // 行高测量走自定义 measureGridRow：挂载与尺寸变化都读真实 DOM 高度，
    // 不信任 itemSizeCache 的残留值（见 measureGridRow 注释）。
    measureElement: measureGridRow,
    // 行 key 用内容身份（首项 id + 列数）而非默认行索引：换柜/筛选/排序/列数变化后
    // 行 key 随之变化，React 重建行 DOM 触发 measureElement 重测。索引复用的 key
    // 会让行 DOM 滞留旧内容的测量语义，行高与内容错位积累，表现为行间间隙/重叠。
    getItemKey: (index) => {
      const first = items[index * lanes];
      return first ? `${first.id}@${lanes}` : index;
    },
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
  }, [lanes, items]);

  // 行高重测无需 virtualizer.measure()：getItemKey 已按内容身份变化触发
  // measureElement 重测；同 key 行的纯高度变化（编辑标签等）由虚拟器内部
  // ResizeObserver 自动校正。measure() 会清空 itemSizeCache 且复用的行 DOM
  // 不会重新触发 ref，高度未变的行将永久停留在 estimateSize（间隙/重叠）。

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
    // 仅键盘单步导航（方向键/Home/End/Shift 扩展）跟随滚动；Ctrl+A 全选、
    // 框选、批量选择不设置跟随标记，视图保持原地（SelectionCanvas 顶部有标记说明）。
    if (consumeSelectionScrollFollow() !== lastSelectedId) return;
    const index = items.findIndex((item) => item.id === lastSelectedId);
    if (index < 0) return;
    virtualizer.scrollToIndex(Math.floor(index / Math.max(1, lanes)), { align: "auto" });
  }, [lastSelectedId, items, lanes, virtualizer]);

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
    return <WorkspaceEmptyState kind={libraryEmpty ? "library" : "filter"} onClearFilters={onClearFilters} onAddItems={onAddItems} />;
  }

  return (
    <SelectionCanvas
      dataRegion="item-grid"
      className="flex-1 overflow-y-auto p-4"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={getItemRects}
    >
      {/* 虚拟化网格：position:relative 撑开滚动高度，每行绝对定位 */}
      <div
        data-region="item-grid-inner"
        role="list"
        aria-label="对象列表"
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
              role="presentation"
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
                  contextSelection={selectedItemIdSet.has(item.id) ? contextSelectionInfo : null}
                />
              ))}
            </div>
          );
        })}
      </div>
    </SelectionCanvas>
  );
}

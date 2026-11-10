import type { ItemViewProps, ItemWithTags } from "../types";
import { ItemPlaceholder, useLoadedRowHeight } from "./ItemPlaceholder";
import { ItemCard } from "./ItemCard";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { SelectionCanvas, consumeSelectionScrollFollow, type Rect } from "./SelectionCanvas";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { gridOverscanRows, setWorkspaceGridLanes, peekPendingItemFocus, focusSelectableItem, clearPendingItemFocus } from "../lib/workspaceChrome";
import type { ContextSelectionInfo } from "./ItemCard";
import { useAppStore } from "../stores/appStore";

/** 网格行间距（16px），与骨架屏保持一致。 */
const GRID_GAP = 16;
/** 卡片行初始估算高度（含 gap）；真实高度由 measureElement 动态校正，避免标签裁剪 */
const GRID_ROW_EST = 200;
const ICONS_ROW_EST = 228;
const FALLBACK_ICON_COL_MIN = 168;

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
function gridColMin(iconLayout: boolean): number {
  if (typeof window === "undefined") return iconLayout ? FALLBACK_ICON_COL_MIN : FALLBACK_COL_MIN;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(iconLayout ? "--grid-col-min-icons" : "--grid-col-min")
    .trim();
  const value = parseFloat(raw);
  const fallback = iconLayout ? FALLBACK_ICON_COL_MIN : FALLBACK_COL_MIN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 首帧前的列数粗估，避免 lanes=1 闪烁（useLayoutEffect 会立即精确校正） */
function estimateInitialLanes(iconLayout: boolean): number {
  if (typeof window === "undefined") return iconLayout ? 6 : 4;
  const approxContent = Math.max(320, window.innerWidth - 300);
  return Math.max(1, Math.floor((approxContent + GRID_GAP) / (gridColMin(iconLayout) + GRID_GAP)));
}

type ItemCardViewProps = Omit<
  ItemViewProps,
  | "view"
  | "contextSelection"
  | "loading"
  | "onSetManyTags"
  | "onRemoveItemsFromCabinet"
  | "selectedItemIds"
  | "onSelectItems"
>;

/** 未选中卡片的稳定空选中集：避免选择数组每次换引用击穿所有可见卡片 memo */
const NO_SELECTION: number[] = [];

const ItemGridCard = memo(function ItemGridCard({
  item,
  viewProps,
  selected,
  contextSelection,
  variant,
  selectedItemIds,
  active,
}: {
  item: ItemWithTags;
  viewProps: ItemCardViewProps;
  selected: boolean;
  contextSelection: ContextSelectionInfo | null;
  variant: "card" | "icon";
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
  // Explorer 语义：拖动已选中项 = 拖整个选中集；未选中项 = 只拖自己。
  // useMemo 保持引用稳定（内联字面量会击穿外层 memo）
  const dragItemIds = useMemo(
    () => (selected && selectedItemIds.length > 1 ? selectedItemIds : [item.id]),
    [selected, selectedItemIds, item.id],
  );

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
      variant={variant}
      dragItemIds={dragItemIds}
      active={active}
    />
  );
});

export function ItemGrid({
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
  const viewMode = useAppStore((state) => state.viewMode);
  const iconLayout = viewMode === "icons";
  // 尺寸缩放（cardSizeVars 已在 store action 中同步写入 CSS 变量，这里读到的是新值）
  const cardSizeScale = useAppStore((state) => state.cardSizeScale);
  const iconSizeScale = useAppStore((state) => state.iconSizeScale);
  const sizeScale = iconLayout ? iconSizeScale : cardSizeScale;
  const rowEstimate = iconLayout ? ICONS_ROW_EST : GRID_ROW_EST;
  /** 少结果旁路：1–3 张卡顶左一组（与满网格同锚点）；icons 仍走虚拟化主路径 */
  const ids = view.ids;
  const count = ids.length;
  const fewResults = Boolean(!libraryEmpty && count > 0 && count <= 3 && !iconLayout);
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
  const itemIds = ids;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [lanes, setLanes] = useState(() => estimateInitialLanes(iconLayout));
  const rowCount = Math.ceil(count / Math.max(1, lanes));

  // 记录每一行的虚拟化测量位置与高度；缺失行用 estimate 估算。
  const rowMetricsRef = useRef<Map<number, { start: number; size: number }>>(new Map());

  const computeLanes = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const w = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const next = Math.max(1, Math.floor((w + GRID_GAP) / (gridColMin(iconLayout) + GRID_GAP)));
    setLanes((prev) => (prev === next ? prev : next));
  }, [iconLayout]);

  // 首帧同步精确测量列数（在浏览器绘制前），消除卡片"全宽闪烁"
  useLayoutEffect(() => {
    computeLanes();
  }, [computeLanes]);

  // 尺寸缩放改变 --grid-col-min(-icons) 后重算列数（变量变化不触发容器 ResizeObserver）
  useEffect(() => {
    computeLanes();
  }, [computeLanes, sizeScale]);

  // 容器宽度变化时动态更新列数
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => computeLanes());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeLanes]);

  useEffect(() => {
    // 少结果视为单行，键盘左右在组内移动；主路径仍用测量列数
    setWorkspaceGridLanes(fewResults ? count : lanes);
    return () => setWorkspaceGridLanes(1);
  }, [fewResults, count, lanes]);

  // 已加载行的真实行高（含 paddingBottom 行间距）：未测量行与占位都按它估算，跳转/取页时行高不再骤变
  const loadedRowHeight = useLoadedRowHeight(scrollRef, rowEstimate);
  // onChange 在滚动事件里调用：经 ref 读最新视图与列数
  const viewRef = useRef(view);
  const lanesRef = useRef(lanes);
  const fewResultsRef = useRef(fewResults);
  useLayoutEffect(() => {
    viewRef.current = view;
    lanesRef.current = lanes;
    fewResultsRef.current = fewResults;
  });
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => loadedRowHeight,
    // 行高测量走自定义 measureGridRow：挂载与尺寸变化都读真实 DOM 高度，
    // 不信任 itemSizeCache 的残留值（见 measureGridRow 注释）。
    measureElement: measureGridRow,
    // 行 key 用内容身份（首项 id + 列数）而非默认行索引：换柜/筛选/排序/列数变化后
    // 行 key 随之变化，React 重建行 DOM 触发 measureElement 重测。索引复用的 key
    // 会让行 DOM 滞留旧内容的测量语义，行高与内容错位积累，表现为行间间隙/重叠。
    getItemKey: (index) => {
      const first = ids[index * lanes];
      return first !== undefined ? `${first}@${lanes}@${iconLayout ? "icons" : "grid"}` : index;
    },
    // 列数自适应 overscan：一行卡片越多预渲染越贵，行数相应减少
    overscan: gridOverscanRows(lanes),
    // 滚动回调里就发起取页（不等 React 提交后的 effect），跳转时省掉一轮渲染
    onChange: (instance) => {
      const rows = instance.getVirtualIndexes();
      if (rows.length === 0 || fewResultsRef.current) return;
      const n = Math.max(1, lanesRef.current);
      viewRef.current.ensureRange(rows[0] * n, (rows[rows.length - 1] + 1) * n);
    },
  });

  // 每次渲染把可见行的真实测量数据记录下来，供 getItemRects 使用。
  // 注意：写 ref 属于副作用，必须放在 useLayoutEffect 中（渲染期写入在并发渲染被丢弃时会残留脏数据）。
  const virtualItems = virtualizer.getVirtualItems();

  // 活动项（roving focus）：选中集末尾；方向键 arm 的 pending 焦点在行挂载后消费
  const activeId = selectedItemIds[selectedItemIds.length - 1] ?? null;
  const activeMounted = useMemo(() => {
    if (activeId == null) return false;
    const idx = view.indexOf(activeId);
    if (idx < 0) return false;
    if (fewResults) return true;
    const row = Math.floor(idx / Math.max(1, lanes));
    return virtualItems.some((v) => v.index === row);
  }, [activeId, fewResults, view, lanes, virtualItems]);

  // 按可视行区间取页（首屏 + 滚动/跳转按需；已缓存的页不重取，过期页重取）
  const firstRow = virtualItems[0]?.index ?? 0;
  const lastRow = virtualItems[virtualItems.length - 1]?.index ?? -1;
  useEffect(() => {
    if (fewResults) view.ensureRange(0, count);
    else if (lastRow >= firstRow) view.ensureRange(firstRow * lanes, (lastRow + 1) * lanes);
  }, [view, fewResults, count, firstRow, lastRow, lanes]);

  // pending 焦点消费：挂载即聚焦（未挂载则等下一次渲染，虚拟化滚动后自然重跑）
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
  useLayoutEffect(() => {
    for (const vRow of virtualItems) {
      rowMetricsRef.current.set(vRow.index, { start: vRow.start, size: vRow.size });
    }
  }, [virtualItems]);

  // lanes 变化后行数重排，旧行索引的度量对应到错误的行，清空等待重新测量，避免框选短暂错位
  useLayoutEffect(() => {
    rowMetricsRef.current.clear();
  }, [lanes, ids, iconLayout]);

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
    if (fewResults) return;
    const index = view.indexOf(lastSelectedId);
    if (index < 0) return;
    virtualizer.scrollToIndex(Math.floor(index / Math.max(1, lanes)), { align: "auto" });
  }, [lastSelectedId, view, lanes, virtualizer, fewResults]);

  // 右键命中多选集时的 contextSelection 由 App 按 ID 取齐对象后统一给出（选中集可能含未缓存对象）。

  const renderItemGridCard = (id: number) => {
    const item = view.get(id);
    if (!item) {
      return (
        <ItemPlaceholder key={id} height={Math.max(40, loadedRowHeight - GRID_GAP)} />
      );
    }
    const isSelected = selectedItemIdSet.has(item.id);
    return (
      <ItemGridCard
        key={item.id}
        item={item}
        viewProps={viewProps}
        selected={isSelected}
        contextSelection={isSelected ? contextSelectionInfo : null}
        variant={iconLayout ? "icon" : "card"}
        selectedItemIds={isSelected ? selectedItemIds : NO_SELECTION}
        active={item.id === activeId}
      />
    );
  };

  // 基于虚拟化器测量数据返回每个 item 在滚动容器内容坐标系中的矩形。
  // 已渲染行使用真实测量值，未渲染行用 estimateSize 估算，从而支持跨屏框选。
  // 注意：此 Hook 必须位于所有条件返回之前，否则违反 Rules of Hooks。
  const getItemRects = useCallback((band?: { top: number; bottom: number }): Map<number, Rect> => {
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
      const rowStart = metric?.start ?? rowIndex * rowEstimate;
      const rowSize = metric?.size ?? rowEstimate;
      const rowTop = paddingTop + rowStart;
      const rowBottom = rowTop + rowSize;
      if (band && (rowBottom < band.top || rowTop > band.bottom)) continue;

      for (let colIndex = 0; colIndex < lanes; colIndex++) {
        const itemIndex = rowIndex * lanes + colIndex;
        if (itemIndex >= count) break;
        const left = paddingLeft + colIndex * (colWidth + GRID_GAP);
        const right = left + colWidth;
        const top = paddingTop + rowStart;
        const bottom = top + rowSize - GRID_GAP; // 行间距不算入卡片
        map.set(ids[itemIndex], { left, top, right, bottom });
      }
    }
    return map;
  }, [lanes, rowCount, ids, count, rowEstimate]);

  if (loading) {
    return <WorkspaceSkeleton view={iconLayout ? "icons" : "grid"} />;
  }

  if (count === 0) {
    // 空态也挂在 SelectionCanvas 里：空白右键背景菜单（添加文件/刷新）在空库/空筛选时同样可用
    return (
      <SelectionCanvas
        dataRegion="item-grid"
        className="min-h-0 flex-1 overflow-y-auto"
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
      dataRegion="item-grid"
      className={fewResults ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1 overflow-y-auto p-5"}
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
      getItemRects={fewResults ? undefined : getItemRects}
      onAddItems={onAddItems}
      onRefreshWorkspace={onRefreshWorkspace}
      containerTabIndex={activeMounted ? -1 : 0}
    >
      {fewResults ? (
        <div data-region="item-grid-inner" role="list" aria-label="项目列表" className="item-grid-few">
          {ids.map((id) => (
            <div key={id} className="item-grid-few-card">
              {renderItemGridCard(id)}
            </div>
          ))}
        </div>
      ) : (
        /* 虚拟化网格：position:relative 撑开滚动高度，每行绝对定位 */
        <div
          data-region="item-grid-inner"
          role="list"
          aria-label="项目列表"
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const startIdx = vRow.index * lanes;
            const rowIds = ids.slice(startIdx, Math.min(startIdx + lanes, count));
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
                {rowIds.map((id) => renderItemGridCard(id))}
              </div>
            );
          })}
        </div>
      )}
    </SelectionCanvas>
  );
}

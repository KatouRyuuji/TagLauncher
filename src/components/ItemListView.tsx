import { memo, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ItemViewProps } from "../types";
import { ItemRow } from "./ItemRow";
import { SelectionCanvas } from "./SelectionCanvas";

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
    onRemove,
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
  const handleRemove = useCallback(() => onRemove(item.id), [item.id, onRemove]);
  const handleToggleFavorite = useCallback(() => onToggleFavorite(item.id), [item.id, onToggleFavorite]);

  return (
    <ItemRow
      item={item}
      tags={tags}
      cabinets={cabinets}
      currentCabinetId={currentCabinetId}
      onLaunch={handleLaunch}
      onRemove={handleRemove}
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
  onRemove,
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
    onRemove,
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
    onRemove,
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
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 6,
  });

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
      dataRegion="item-list"
      className="flex-1 overflow-y-auto px-5 py-5"
      itemIds={itemIds}
      selectedItemIds={selectedItemIds}
      onSelectItems={onSelectItems}
      scrollElementRef={scrollRef}
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
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
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

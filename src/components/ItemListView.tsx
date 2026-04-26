import { memo, useCallback, useMemo } from "react";
import type { ItemViewProps } from "../types";
import { ItemRow } from "./ItemRow";

const ItemListRow = memo(function ItemListRow({
  item,
  viewProps,
}: {
  item: ItemViewProps["items"][number];
  viewProps: Omit<ItemViewProps, "items" | "loading">;
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
      onUpdateThumbnail={onUpdateThumbnail}
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
  onUpdateThumbnail,
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
    onUpdateThumbnail,
  ]);

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
    <div data-region="item-list" className="flex-1 overflow-y-auto px-5 py-5">
      <div className="surface-card overflow-hidden">
        <div className="sticky top-0 z-10 grid grid-cols-[56px_minmax(0,1fr)_minmax(180px,300px)_112px] items-center gap-4 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_96%,transparent)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
          <span />
          <span>名称</span>
          <span>标签</span>
          <span className="text-right">类型</span>
        </div>

        {items.map((item) => (
          <ItemListRow
            key={item.id}
            item={item}
            viewProps={viewProps}
          />
        ))}
      </div>
    </div>
  );
}

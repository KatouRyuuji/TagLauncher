import type { ItemViewProps } from "../types";
import { ItemCard } from "./ItemCard";

export function ItemGrid({
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
    <div data-region="item-grid" className="flex-1 overflow-y-auto px-5 py-5">
      <div
        data-region="item-grid-inner"
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--grid-col-min), 1fr))" }}
      >
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            tags={tags}
            cabinets={cabinets}
            currentCabinetId={currentCabinetId}
            onLaunch={() => onLaunch(item.id)}
            onRemove={() => onRemove(item.id)}
            onSetTags={onSetTags}
            onAddTagToItem={onAddTagToItem}
            onRemoveTagFromItem={onRemoveTagFromItem}
            onAddNewTagToItem={onAddNewTagToItem}
            onToggleFavorite={() => onToggleFavorite(item.id)}
            onAddItemToCabinet={onAddItemToCabinet}
            onRemoveItemFromCabinet={onRemoveItemFromCabinet}
            onUpdateThumbnail={onUpdateThumbnail}
          />
        ))}
      </div>
    </div>
  );
}

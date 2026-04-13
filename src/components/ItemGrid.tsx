// ============================================================================
// components/ItemGrid.tsx — 网格视图容器
// ============================================================================
// 使用 CSS Grid 自适应布局展示项目卡片。
// 每个卡片最小宽度 180px，自动填充可用空间。
// 处理加载状态和空状态的显示。
// ============================================================================

import type { ItemViewProps } from "../types";
import { ItemCard } from "./ItemCard";

export function ItemGrid({ items, tags, cabinets, loading, currentCabinetId, onLaunch, onRemove, onSetTags, onAddTagToItem, onRemoveTagFromItem, onAddNewTagToItem, onToggleFavorite, onAddItemToCabinet, onRemoveItemFromCabinet, onUpdateThumbnail }: ItemViewProps) {
  // 加载中状态
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
        加载中...
      </div>
    );
  }

  // 空状态
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-white/20">
        <div className="text-5xl mb-4 opacity-50">📁</div>
        <p className="text-sm">暂无项目</p>
        <p className="text-xs mt-1.5 text-white/15">拖拽文件到此处，或点击上方按钮添加</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      {/* 自适应网格：每列最小 180px，自动填充 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
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

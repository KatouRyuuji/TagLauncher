// ============================================================================
// components/ItemListView.tsx — 列表视图容器
// ============================================================================
// 表格式布局展示项目，包含固定表头（名称/标签/类型）。
// 每行使用 ItemRow 组件渲染。
// 处理加载状态和空状态的显示。
// ============================================================================

import type { ItemViewProps } from "../types";
import { ItemRow } from "./ItemCard";

export function ItemListView({ items, tags, cabinets, loading, currentCabinetId, onLaunch, onRemove, onSetTags, onAddTagToItem, onRemoveTagFromItem, onAddNewTagToItem, onToggleFavorite, onAddItemToCabinet, onRemoveItemFromCabinet, onUpdateThumbnail }: ItemViewProps) {
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
    <div className="flex-1 overflow-y-auto">
      {/* 固定表头（sticky） */}
      <div className="flex items-center gap-3 px-4 py-2 text-[14px] font-medium text-white/30 uppercase tracking-wide border-b border-white/[0.06] bg-white/[0.02] sticky top-0">
        <span className="w-7" />
        <span className="flex-1">名称</span>
        <span className="w-[300px] shrink-0">标签</span>
        <span className="w-24 text-right shrink-0">类型/后缀</span>
      </div>
      {/* 项目行列表 */}
      {items.map((item) => (
        <ItemRow
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
  );
}

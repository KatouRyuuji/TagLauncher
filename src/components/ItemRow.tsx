import { useState } from "react";
import { ItemTagsEditor } from "./ItemTagsEditor";
import { ContextMenu } from "./ContextMenu";
import { DraggableTagList } from "./DraggableTagList";
import { ItemVisualIcon } from "./ItemVisualIcon";
import { ItemDragHandle } from "./ItemDragHandle";
import { FavoriteStar } from "./FavoriteStar";
import { getTypeLabel, getFileSuffix } from "../lib/itemUtils";
import { useInternalDragStore } from "../stores/internalDragStore";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";
import type { ItemCardProps } from "./ItemCard";

export function ItemRow({
  item, tags, cabinets, currentCabinetId,
  onLaunch, onRemove, onRemoveTagFromItem, onAddNewTagToItem,
  onSetTags, onToggleFavorite, onAddItemToCabinet,
  onRemoveItemFromCabinet, onUpdateThumbnail,
}: ItemCardProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const activeDrag = useInternalDragStore((state) => state.drag);
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cab) => cab.id === currentCabinetId)?.name ?? null;
  const tagDragOver =
    activeDrag?.kind === "tag" &&
    hoverTarget?.kind === "tag-item" &&
    hoverTarget.itemId === item.id;

  const handleItemHandlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    beginInternalPointerDrag({
      event,
      payload: { kind: "item", itemId: item.id, label: item.name },
      findHoverTarget: (pointerEvent) => {
        const favoriteTarget = findClosestNumberDataAttribute(
          pointerEvent.clientX, pointerEvent.clientY,
          "[data-drop-item-favorite]", "dropItemFavorite",
        );
        if (favoriteTarget === 1) return { kind: "item-favorites" };
        const cabinetId = findClosestNumberDataAttribute(
          pointerEvent.clientX, pointerEvent.clientY,
          "[data-drop-item-cabinet-id]", "dropItemCabinetId",
        );
        return cabinetId === null ? null : { kind: "item-cabinet", cabinetId };
      },
      onDrop: async (target) => {
        if (target?.kind === "item-favorites") {
          if (!item.is_favorite) await onToggleFavorite();
          return;
        }
        if (target?.kind === "item-cabinet") {
          await onAddItemToCabinet(target.cabinetId, item.id);
        }
      },
    });
  };

  return (
    <>
      <div
        data-drop-tag-item-id={item.id}
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-all group border-b border-[var(--border-subtle)] ${
          tagDragOver ? "bg-[var(--accent-primary-bg-light)]" : ""
        }`}
        onDoubleClick={onLaunch}
        onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }); }}
        onKeyDown={(e) => e.key === "Enter" && onLaunch()}
        tabIndex={0}
      >
        <ItemDragHandle onPointerDown={handleItemHandlePointerDown} className="h-5 w-5" />
        <FavoriteStar active={item.is_favorite} />
        <ItemVisualIcon
          item={item}
          emojiClass="text-xl shrink-0"
          imageClass="w-8 h-8 rounded-[var(--radius-md)] object-cover border border-[var(--border-subtle)] bg-[var(--bg-card)] shrink-0"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-[var(--text-primary)] text-sm truncate" title={item.name}>{item.name}</h3>
          <p className="text-[11px] text-[var(--text-ghost)] truncate" title={item.path}>{item.path}</p>
        </div>
        <div className="shrink-0 max-w-[300px]">
          <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} compact />
        </div>
        <div className="shrink-0 w-24 text-right leading-tight">
          <p className="text-[17px] text-[var(--text-tertiary)] truncate border-b border-[var(--border-strong)] pb-0.5" title={getTypeLabel(item.type)}>
            {getTypeLabel(item.type)}
          </p>
          <p className="text-[16px] text-[var(--text-muted)] truncate border-b border-[var(--border-medium)] pb-0.5 mt-1" title={getFileSuffix(item)}>
            {getFileSuffix(item)}
          </p>
        </div>
      </div>

      {menuPos && (
        <ContextMenu
          item={item} cabinets={cabinets} currentCabinetId={currentCabinetId}
          currentCabinetName={currentCabinetName} position={menuPos}
          onClose={() => setMenuPos(null)} onLaunch={onLaunch} onRemove={onRemove}
          onEditTags={() => setShowTagEditor(true)} onToggleFavorite={onToggleFavorite}
          onAddItemToCabinet={onAddItemToCabinet} onRemoveItemFromCabinet={onRemoveItemFromCabinet}
          onUpdateThumbnail={onUpdateThumbnail}
        />
      )}

      {showTagEditor && (
        <ItemTagsEditor
          item={item} tags={tags}
          onSave={async (tagIds) => { await onSetTags(item.id, tagIds); setShowTagEditor(false); }}
          onAddNewTag={async (name, baseTagIds) => onAddNewTagToItem(item.id, name, baseTagIds)}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </>
  );
}

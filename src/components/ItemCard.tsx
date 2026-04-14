import { useState } from "react";
import type { ItemWithTags, Tag, Cabinet } from "../types";
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

export interface ItemCardProps {
  item: ItemWithTags;
  tags: Tag[];
  cabinets: Cabinet[];
  currentCabinetId: number | null;
  onLaunch: () => void;
  onRemove: () => void;
  onAddTagToItem: (itemId: number, tagId: number) => Promise<void>;
  onRemoveTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  onAddNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  onSetTags: (itemId: number, tagIds: number[]) => Promise<void>;
  onToggleFavorite: () => void;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onRemoveItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onUpdateThumbnail: (itemId: number, iconPath: string | null) => Promise<void>;
}

function useItemDrag(item: ItemWithTags, onToggleFavorite: () => void, onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>) {
  return (event: React.PointerEvent<HTMLSpanElement>) => {
    beginInternalPointerDrag({
      event,
      payload: {
        kind: "item",
        itemId: item.id,
        label: item.name,
      },
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
}

export function ItemCard({
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

  const handleItemHandlePointerDown = useItemDrag(item, onToggleFavorite, onAddItemToCabinet);

  return (
    <>
      <div
        data-drop-tag-item-id={item.id}
        className={`card-hover-lift bg-[var(--bg-card)] border rounded-[var(--radius-lg)] p-3 cursor-pointer hover:bg-[var(--bg-hover)] group ${
          tagDragOver ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)]" : "border-[var(--border-subtle)] hover:border-[var(--border-default)]"
        }`}
        style={{ backdropFilter: 'var(--card-backdrop-filter)' }}
        onDoubleClick={onLaunch}
        onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }); }}
        onKeyDown={(e) => e.key === "Enter" && onLaunch()}
        tabIndex={0}
      >
        <div className="flex items-start justify-between mb-2 gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <ItemVisualIcon
              item={item}
              emojiClass="text-[28px]"
              imageClass="w-10 h-10 rounded-[var(--radius-md)] object-cover border border-[var(--border-subtle)] bg-[var(--bg-card)]"
            />
            <div className="min-w-0">
              <p className="text-[17px] text-[var(--text-tertiary)] truncate border-b border-[var(--border-strong)] pb-0 leading-tight" title={getTypeLabel(item.type)}>
                {getTypeLabel(item.type)}
              </p>
              <p className="text-[16px] text-[var(--text-muted)] truncate border-b border-[var(--border-medium)] pb-0 mt-0.5 leading-tight" title={getFileSuffix(item)}>
                {getFileSuffix(item)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ItemDragHandle onPointerDown={handleItemHandlePointerDown} />
            <FavoriteStar active={item.is_favorite} />
          </div>
        </div>
        <h3 className="text-[var(--text-primary)] text-sm font-medium truncate mb-0" title={item.name}>{item.name}</h3>
        <p className="text-[10px] text-[var(--text-faint)] truncate mb-1.5" title={item.path}>{item.path}</p>
        <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} />
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

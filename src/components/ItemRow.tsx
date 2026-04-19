import { useState } from "react";
import { ContextMenu } from "./ContextMenu";
import { DraggableTagList } from "./DraggableTagList";
import { FavoriteStar } from "./FavoriteStar";
import { ItemDragHandle } from "./ItemDragHandle";
import { ItemTagsEditor } from "./ItemTagsEditor";
import { ItemVisualIcon } from "./ItemVisualIcon";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";
import { getFileSuffix, getTypeLabel } from "../lib/itemUtils";
import { useInternalDragStore } from "../stores/internalDragStore";
import type { ItemCardProps } from "./ItemCard";

export function ItemRow({
  item,
  tags,
  cabinets,
  currentCabinetId,
  onLaunch,
  onRemove,
  onRemoveTagFromItem,
  onAddNewTagToItem,
  onSetTags,
  onToggleFavorite,
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onUpdateThumbnail,
}: ItemCardProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const activeDrag = useInternalDragStore((state) => state.drag);
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cabinet) => cabinet.id === currentCabinetId)?.name ?? null;
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
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-favorite]",
          "dropItemFavorite",
        );
        if (favoriteTarget === 1) return { kind: "item-favorites" };

        const cabinetId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-cabinet-id]",
          "dropItemCabinetId",
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
        className={`grid grid-cols-[56px_minmax(0,1fr)_minmax(180px,300px)_112px] items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-3 ${
          tagDragOver ? "bg-[var(--accent-primary-bg-light)]" : "hover:bg-[var(--bg-hover)]"
        }`}
        onDoubleClick={onLaunch}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPos({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => event.key === "Enter" && onLaunch()}
        tabIndex={0}
      >
        <div className="flex items-center gap-2">
          <ItemDragHandle onPointerDown={handleItemHandlePointerDown} className="h-8 w-8" />
          <span className="inline-flex h-7 w-7 items-center justify-center">
            <FavoriteStar active={item.is_favorite} />
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[22px]">
            <ItemVisualIcon
              item={item}
              emojiClass="leading-none"
              imageClass="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]" title={item.name}>
              {item.name}
            </h3>
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={item.path}>
              {item.path}
            </p>
          </div>
        </div>

        <div className="max-w-[300px]">
          <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} compact />
        </div>

        <div className="text-right">
          <p className="text-sm font-semibold text-[var(--text-tertiary)]" title={getTypeLabel(item.type)}>
            {getTypeLabel(item.type)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]" title={getFileSuffix(item)}>
            {getFileSuffix(item)}
          </p>
        </div>
      </div>

      {menuPos && (
        <ContextMenu
          item={item}
          cabinets={cabinets}
          currentCabinetId={currentCabinetId}
          currentCabinetName={currentCabinetName}
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onLaunch={onLaunch}
          onRemove={onRemove}
          onEditTags={() => setShowTagEditor(true)}
          onToggleFavorite={onToggleFavorite}
          onAddItemToCabinet={onAddItemToCabinet}
          onRemoveItemFromCabinet={onRemoveItemFromCabinet}
          onUpdateThumbnail={onUpdateThumbnail}
        />
      )}

      {showTagEditor && (
        <ItemTagsEditor
          item={item}
          tags={tags}
          onSave={async (tagIds) => {
            await onSetTags(item.id, tagIds);
            setShowTagEditor(false);
          }}
          onAddNewTag={async (name, baseTagIds) => onAddNewTagToItem(item.id, name, baseTagIds)}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </>
  );
}

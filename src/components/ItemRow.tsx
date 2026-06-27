import { memo, useState } from "react";
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
import { useModItemSlots } from "../hooks/useModItemSlots";
import { useSlotContainer } from "./ItemCard";
import type { ItemCardProps } from "./ItemCard";

function ItemRowComponent({
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
  onClearCurrentFilter,
  onRequestRemoveFromApp,
  onUpdateThumbnail,
  selected,
}: ItemCardProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);

  // Mod 插槽（与 ItemCard 对等：header / actions / footer）
  const modSlots = useModItemSlots();
  const headerSlotRef = useSlotContainer(modSlots.header, item);
  const actionsSlotRef = useSlotContainer(modSlots.actions, item);
  const footerSlotRef = useSlotContainer(modSlots.footer, item);
  const tagDragOver = useInternalDragStore((state) =>
    state.drag?.kind === "tag" &&
    state.hoverTarget?.kind === "tag-item" &&
    state.hoverTarget.itemId === item.id,
  );
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cabinet) => cabinet.id === currentCabinetId)?.name ?? null;

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
        if (cabinetId !== null) return { kind: "item-cabinet", cabinetId };

        const clearCurrentFilter = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-clear-current-filter]",
          "dropItemClearCurrentFilter",
        );
        if (clearCurrentFilter === 1) return { kind: "item-clear-current-filter" };

        const removeFromApp = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-remove-from-app]",
          "dropItemRemoveFromApp",
        );
        return removeFromApp === 1 ? { kind: "item-remove-from-app" } : null;
      },
      onDrop: async (target) => {
        if (target?.kind === "item-favorites") {
          if (!item.is_favorite) await onToggleFavorite();
          return;
        }
        if (target?.kind === "item-cabinet") {
          await onAddItemToCabinet(target.cabinetId, item.id);
          return;
        }
        if (target?.kind === "item-clear-current-filter") {
          await onClearCurrentFilter(item.id);
          return;
        }
        if (target?.kind === "item-remove-from-app") {
          await onRequestRemoveFromApp(item.id);
        }
      },
    });
  };

  return (
    <>
      <div
        data-drop-tag-item-id={item.id}
        data-selectable-item-id={item.id}
        className={`item-row-render-scope grid grid-cols-[56px_minmax(0,1fr)_minmax(180px,300px)_112px] items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-3 ${
          tagDragOver
            ? "bg-[var(--accent-primary-bg-light)]"
            : selected
            ? "bg-[var(--accent-primary-bg)] shadow-[inset_3px_0_0_var(--accent-primary)]"
            : "hover:bg-[var(--bg-hover)]"
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
          {modSlots.header.length > 0 && <div ref={headerSlotRef} className="flex items-center" />}
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
            <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-[var(--text-primary)]" title={item.name}>
              <span className="truncate">{item.name}</span>
              {item.is_missing && (
                <span
                  className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-warning)] px-1 py-0.5 text-[9px] font-semibold leading-none text-[var(--color-warning)]"
                  title="文件已丢失或移动到其他磁盘；应用内归类已保留，文件恢复后会自动重新关联"
                >
                  ⚠ 失效
                </span>
              )}
            </h3>
            <p
              className={`mt-1 truncate text-xs ${item.is_missing ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"}`}
              title={item.is_missing ? `最近已知位置：${item.path}` : item.path}
            >
              {item.path}
            </p>
          </div>
        </div>

        <div className="max-w-[300px]">
          <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} compact />
        </div>

        <div className="text-right">
          {modSlots.actions.length > 0 && <div ref={actionsSlotRef} className="mb-1 flex justify-end" />}
          <p className="text-sm font-semibold text-[var(--text-tertiary)]" title={getTypeLabel(item.type)}>
            {getTypeLabel(item.type)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]" title={getFileSuffix(item)}>
            {getFileSuffix(item)}
          </p>
        </div>
      </div>

      {modSlots.footer.length > 0 && (
        <div ref={footerSlotRef} className="px-4 py-1 border-b border-[var(--border-subtle)]" />
      )}

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

export const ItemRow = memo(ItemRowComponent);

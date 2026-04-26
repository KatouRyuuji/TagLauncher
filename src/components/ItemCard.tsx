import { memo, useState, useRef, useEffect } from "react";
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
import type { Cabinet, ItemWithTags, Tag } from "../types";
import type { ItemSlotDescriptor } from "../lib/modItemSlotRegistry";

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

function useItemDrag(
  item: ItemWithTags,
  onToggleFavorite: () => void,
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>,
) {
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
}

/** 将 Mod 插槽的 HTMLElement 挂载到 ref 指向的容器 */
function useSlotContainer(slots: ItemSlotDescriptor[], item: ItemWithTags) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || slots.length === 0) return;
    ref.current.innerHTML = "";
    for (const slot of slots) {
      try {
        const el = slot.render(item);
        el.setAttribute("data-mod-slot", slot.modId);
        ref.current.appendChild(el);
      } catch (err) {
        console.warn(`[ItemCard] Slot render error from mod "${slot.modId}":`, err);
      }
    }
  }, [slots, item]);
  return ref;
}

function ItemCardComponent({
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
  const tagDragOver = useInternalDragStore((state) =>
    state.drag?.kind === "tag" &&
    state.hoverTarget?.kind === "tag-item" &&
    state.hoverTarget.itemId === item.id,
  );
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cabinet) => cabinet.id === currentCabinetId)?.name ?? null;

  const handleItemHandlePointerDown = useItemDrag(item, onToggleFavorite, onAddItemToCabinet);
  const fileSuffix = getFileSuffix(item);

  // Mod ItemCard 插槽
  const modSlots = useModItemSlots();
  const headerSlotRef = useSlotContainer(modSlots.header, item);
  const actionsSlotRef = useSlotContainer(modSlots.actions, item);
  const footerSlotRef = useSlotContainer(modSlots.footer, item);

  return (
    <>
      <article
        data-drop-tag-item-id={item.id}
        className={`card-hover-lift item-card-render-scope group relative flex min-h-[156px] cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--bg-card)] p-3 ${
          tagDragOver
            ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)]"
            : "border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]"
        }`}
        style={{ backdropFilter: "var(--card-backdrop-filter)" }}
        onDoubleClick={onLaunch}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPos({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => event.key === "Enter" && onLaunch()}
        tabIndex={0}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--accent-primary),transparent)] opacity-60" />

        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[24px]">
              <ItemVisualIcon
                item={item}
                emojiClass="leading-none"
                imageClass="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--accent-primary)]" title={getTypeLabel(item.type)}>
                {getTypeLabel(item.type)}
              </p>
              <h3 className="mt-0.5 truncate text-[15px] font-semibold leading-tight text-[var(--text-primary)]" title={item.name}>
                {item.name}
              </h3>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <ItemDragHandle onPointerDown={handleItemHandlePointerDown} />
            <span className="inline-flex h-7 w-7 items-center justify-center">
              <FavoriteStar active={item.is_favorite} />
            </span>
            {/* Mod 插槽：header */}
            {modSlots.header.length > 0 && (
              <div ref={headerSlotRef} className="flex items-center gap-1" />
            )}
          </div>
        </div>

        <p className="mt-2 line-clamp-2 min-h-[30px] break-all text-[11px] leading-4.5 text-[var(--text-muted)]" title={item.path}>
          {item.path}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
              后缀
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-[var(--text-tertiary)]" title={fileSuffix}>
              {fileSuffix}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Mod 插槽：actions */}
            {modSlots.actions.length > 0 && (
              <div ref={actionsSlotRef} className="flex items-center gap-1" />
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLaunch();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onLaunch();
                }
              }}
              className="rounded-[var(--radius-full)] border border-[color-mix(in_srgb,var(--accent-primary)_22%,transparent)] bg-[var(--accent-primary-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-[var(--text-invert)]"
            >
              启动
            </button>
          </div>
        </div>

        <div className="mt-2.5 min-h-[24px]">
          <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} />
        </div>

        {/* Mod 插槽：footer */}
        {modSlots.footer.length > 0 && (
          <div ref={footerSlotRef} className="mt-2" />
        )}
      </article>

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

export const ItemCard = memo(ItemCardComponent);

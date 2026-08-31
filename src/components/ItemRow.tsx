import { memo, useState } from "react";
import { TriangleAlert } from "lucide-react";
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
import { useAppStore } from "../stores/appStore";
import { useModItemSlots } from "../hooks/useModItemSlots";
import { useSlotContainer } from "./ItemCard";
import { SearchHighlightText } from "./SearchHighlightText";
import type { ItemCardProps } from "./ItemCard";

/** 表头、数据行与骨架共同消费同一列模板，避免列宽漂移。 */
export const ITEM_LIST_GRID_TEMPLATE = "64px minmax(0,1fr) minmax(140px,280px) 96px";
/** 普通行的稳定基准高度；Mod footer 与多行标签仍由虚拟化器动态测量。 */
export const ITEM_LIST_BASE_ROW_HEIGHT = 60;

function ItemRowComponent({
  item,
  tags,
  cabinets,
  currentCabinetId,
  onLaunch,
  onRemoveTagFromItem,
  onAddNewTagToItem,
  onRecycleNewTags,
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
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const searchQuery = useAppStore((state) => state.searchQuery);

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
        role="listitem"
        style={{ minHeight: ITEM_LIST_BASE_ROW_HEIGHT, gridTemplateColumns: ITEM_LIST_GRID_TEMPLATE }}
        className={`item-row-render-scope item-focus-ring group grid items-center gap-3 border-b border-[var(--line-hairline)] px-3 py-2 transition-[background-color,box-shadow] ${
          tagDragOver
            ? "bg-[var(--accent-primary-bg-light)] shadow-[inset_3px_0_0_var(--accent-primary)]"
            : selected
            ? "bg-[var(--accent-primary-bg)] shadow-[inset_3px_0_0_var(--accent-primary)]"
            : "hover:bg-[var(--bg-hover)]"
        }`}
        onDoubleClick={onLaunch}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPos({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          // 仅当事件源自行本身时响应 Enter；stopPropagation 避免与 window 热键重复启动。
          if (event.key !== "Enter" || event.target !== event.currentTarget) return;
          event.preventDefault();
          event.stopPropagation();
          onLaunch();
        }}
        tabIndex={0}
      >
        <div className="flex items-center gap-1">
          <ItemDragHandle onPointerDown={handleItemHandlePointerDown} className="h-7 w-7" />
          <span className="inline-flex h-7 w-7 items-center justify-center">
            <FavoriteStar active={item.is_favorite} onClick={onToggleFavorite} />
          </span>
          {modSlots.header.length > 0 && <div ref={headerSlotRef} className="flex min-w-0 items-center" />}
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] text-xl">
            <ItemVisualIcon
              item={item}
              emojiClass="leading-none"
              imageClass="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate text-[13px] font-semibold leading-5 text-[var(--text-primary)]" title={item.name}>
              <span className="truncate">
                <SearchHighlightText text={item.name} query={searchQuery} />
              </span>
              {item.is_missing && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[var(--status-warning-bg)] px-1 py-0.5 text-[9px] font-semibold leading-none text-[var(--color-warning)]"
                  title="文件已丢失或移动到其他磁盘；应用内归类已保留，文件恢复后会自动重新关联"
                >
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                  失效
                </span>
              )}
            </h3>
            <p
              className={`mt-0.5 truncate text-[11px] leading-4 ${item.is_missing ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"}`}
              title={item.is_missing ? `最近已知位置：${item.path}` : item.path}
            >
              {item.path}
            </p>
          </div>
        </div>

        <div className="min-w-0 max-w-[280px] overflow-hidden">
          <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} compact />
        </div>

        <div className="text-right">
          {modSlots.actions.length > 0 && <div ref={actionsSlotRef} className="mb-0.5 flex justify-end" />}
          <p className="truncate text-xs font-semibold text-[var(--text-secondary)]" title={getTypeLabel(item.type)}>
            {getTypeLabel(item.type)}
          </p>
          <p className="data-readout mt-0.5 truncate text-[10px] text-[var(--text-faint)]" title={getFileSuffix(item)}>
            {getFileSuffix(item)}
          </p>
        </div>
      </div>

      {modSlots.footer.length > 0 && (
        <div ref={footerSlotRef} className="border-b border-[var(--line-hairline)] px-3 py-1.5" />
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
          onRemove={() => void onRequestRemoveFromApp(item.id)}
          onEditTags={() => setShowTagEditor(true)}
          onToggleFavorite={onToggleFavorite}
          onPreview={() => setPreviewItemId(item.id)}
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
          onRecycleNewTags={onRecycleNewTags}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </>
  );
}

export const ItemRow = memo(ItemRowComponent);

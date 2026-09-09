import { memo, useState, useRef, useEffect } from "react";
import { Check, Play, TriangleAlert } from "lucide-react";
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
import { showToast } from "../lib/toast";
import { useInternalDragStore } from "../stores/internalDragStore";
import { useAppStore } from "../stores/appStore";
import { useModItemSlots } from "../hooks/useModItemSlots";
import { SearchHighlightText } from "./SearchHighlightText";
import type { Cabinet, ItemWithTags, Tag } from "../types";
import type { ItemSlotDescriptor } from "../lib/modItemSlotRegistry";

/**
 * 右键命中多选集时注入的选中集信息：右键菜单的删除/收藏/复制路径据此
 * 作用于整个选中集而非仅右击项。由 ItemGrid/ItemListView 统一构造。
 */
export interface ContextSelectionInfo {
  ids: number[];
  paths: string[];
  /** 多选收藏目标态：有未收藏项则为 true（与 Ctrl+D 同口径） */
  favoriteTarget: boolean;
}

export interface ItemCardProps {
  item: ItemWithTags;
  tags: Tag[];
  cabinets: Cabinet[];
  currentCabinetId: number | null;
  onLaunch: () => void;
  onRemoveTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  onAddNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  onRecycleNewTags?: (tagIds: number[]) => Promise<void>;
  onSetTags: (itemId: number, tagIds: number[]) => Promise<void>;
  onToggleFavorite: () => void;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onRemoveItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onClearCurrentFilter: (itemId: number) => Promise<void>;
  onRequestRemoveFromApp: (itemId: number) => Promise<void>;
  onUpdateThumbnail: (itemId: number, iconPath: string | null) => Promise<void>;
  selected: boolean;
  /** 右击项属于当前多选集时非 null；ContextMenu 据此把部分动作扩展到整个选中集 */
  contextSelection?: ContextSelectionInfo | null;
}

function useItemDrag(
  item: ItemWithTags,
  currentCabinetId: number | null,
  onToggleFavorite: () => void,
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>,
  onClearCurrentFilter: (itemId: number) => Promise<void>,
  onRequestRemoveFromApp: (itemId: number) => Promise<void>,
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
          // 已收藏时拖到收藏区不再静默无效
          if (!item.is_favorite) await onToggleFavorite();
          else showToast(`「${item.name}」已在收藏中`, "info");
          return;
        }
        if (target?.kind === "item-cabinet") {
          // 前端可确定的重复（拖到当前所在柜）直接提示，不发请求
          if (target.cabinetId === currentCabinetId) {
            showToast(`「${item.name}」已在此文件柜中`, "info");
            return;
          }
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
}

/** 将 Mod 插槽的 HTMLElement 挂载到 ref 指向的容器（卡片/行共用） */
export function useSlotContainer(slots: ItemSlotDescriptor[], item: ItemWithTags) {
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
  contextSelection,
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

  const handleItemHandlePointerDown = useItemDrag(
    item,
    currentCabinetId,
    onToggleFavorite,
    onAddItemToCabinet,
    onClearCurrentFilter,
    onRequestRemoveFromApp,
  );
  const fileSuffix = getFileSuffix(item);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const searchQuery = useAppStore((state) => state.searchQuery);

  // Mod ItemCard 插槽
  const modSlots = useModItemSlots();
  const headerSlotRef = useSlotContainer(modSlots.header, item);
  const actionsSlotRef = useSlotContainer(modSlots.actions, item);
  const footerSlotRef = useSlotContainer(modSlots.footer, item);

  return (
    <>
      <article
        data-drop-tag-item-id={item.id}
        data-selectable-item-id={item.id}
        data-selected={selected ? "true" : "false"}
        role="listitem"
        aria-label={`${item.name}${selected ? "，已选择" : ""}`}
        className={`card-hover-lift item-card-render-scope item-focus-ring group relative flex cursor-pointer flex-col rounded-[var(--radius-lg)] border bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-card)] ${
          tagDragOver
            ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)]"
            : selected
            ? "border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--surface-raised)_88%,var(--accent-primary-bg))] shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]"
            : "border-[var(--line-hairline)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]"
        }`}
        style={{ backdropFilter: "var(--card-backdrop-filter)" }}
        onDoubleClick={onLaunch}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPos({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          // 仅当事件源自卡片本身时响应 Enter；stopPropagation 避免与 window 热键重复启动。
          if (event.key !== "Enter" || event.target !== event.currentTarget) return;
          event.preventDefault();
          event.stopPropagation();
          onLaunch();
        }}
        tabIndex={0}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] text-[26px]">
            <ItemVisualIcon
              item={item}
              emojiClass="leading-none"
              imageClass="h-full w-full object-cover"
            />
          </div>

          {/* 文本列为右上角的星标/选中勾预留安全间距，任何状态下文字不与控件重叠 */}
          <div className={`min-w-0 flex-1 ${selected ? "pr-16" : "pr-9"}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-[var(--text-primary)]" title={item.name}>
                <SearchHighlightText text={item.name} query={searchQuery} />
              </h3>
              {item.is_missing && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[13px] font-semibold leading-none text-[var(--color-warning)]"
                  title="文件已丢失或移动到其他磁盘；应用内归类已保留，文件恢复后会自动重新关联"
                >
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                  失效
                </span>
              )}
            </div>
            <p
              className={`mt-0.5 truncate text-[13px] leading-4 ${
                item.is_missing ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"
              }`}
              title={item.is_missing ? `最近已知位置：${item.path}` : item.path}
            >
              {item.path}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-[var(--text-faint)]">
              <span className="instrument-label truncate" title={getTypeLabel(item.type)}>
                {getTypeLabel(item.type)}
              </span>
              {fileSuffix !== "无后缀" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="data-readout truncate" title={fileSuffix}>
                    {fileSuffix}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 右上角常驻区：仅选中勾与星标（星标非收藏时半隐，组件内处理） */}
          <div className="absolute right-2.5 top-2.5 flex items-center gap-0.5">
            {modSlots.header.length > 0 && <div ref={headerSlotRef} className="flex items-center gap-1" />}
            {selected && (
              <span
                className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] text-[var(--text-invert)]"
                role="img"
                aria-label="已选择"
                title="已选择"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              </span>
            )}
            <FavoriteStar active={item.is_favorite} onClick={onToggleFavorite} />
          </div>
        </div>

        {/* 标签行：左侧标签列表，右侧启动/拖拽（悬停显现，在文档流内、不与文字重叠） */}
        <div className="mt-2.5 flex min-h-7 items-center gap-2">
          <div className="min-w-0 flex-1">
            <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Mod 插槽：actions */}
            {modSlots.actions.length > 0 && <div ref={actionsSlotRef} className="flex items-center gap-1" />}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLaunch();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              title="启动"
              aria-label={`启动 ${item.name}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] opacity-0 transition-[color,background-color,opacity] hover:bg-[var(--accent-primary)] hover:text-[var(--text-invert)] focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Play className="h-3 w-3" fill="currentColor" aria-hidden="true" />
            </button>
            <ItemDragHandle
              onPointerDown={handleItemHandlePointerDown}
              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            />
          </div>
        </div>

        {/* Mod 插槽：footer */}
        {modSlots.footer.length > 0 && (
          <div ref={footerSlotRef} className="mt-2 border-t border-[var(--line-hairline)] pt-2" />
        )}
      </article>

      {menuPos && (
        <ContextMenu
          item={item}
          cabinets={cabinets}
          currentCabinetId={currentCabinetId}
          currentCabinetName={currentCabinetName}
          contextSelection={contextSelection}
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

export const ItemCard = memo(ItemCardComponent);

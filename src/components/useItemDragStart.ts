import { beginInternalPointerDrag, findClosestNumberDataAttribute } from "../lib/internalPointerDrag";
import { showToast } from "../lib/toast";
import type { Cabinet, ItemWithTags } from "../types";

export interface ItemDragStartOptions {
  item: ItemWithTags;
  cabinets: Cabinet[];
  currentCabinetId: number | null;
  /** 整组拖（Explorer 语义：拖动已选中项 = 拖整个选中集）；缺省 [item.id] */
  dragItemIds?: number[];
  onToggleFavorite: () => void;
  onSetFavorites?: (ids: number[], favorite: boolean) => Promise<void>;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onAddItemsToCabinet?: (cabinetId: number, itemIds: number[]) => Promise<void>;
  onClearCurrentFilter: (itemId: number) => Promise<void>;
  /** 批量清除当前筛选归类（整组拖拽落点用，单次 IPC/事务） */
  onClearCurrentFilters?: (itemIds: number[]) => Promise<void>;
  onRequestRemoveFromApp: (itemId: number) => Promise<void>;
  onRequestBatchRemoveFromApp?: () => Promise<void>;
}

/**
 * 对象拖拽起手（抓手与卡片本体共用）：6px 阈值、落点查找与批量结算。
 * 多选时 payload.itemIds 为整个选中集；落点反馈（I-6）集中在 onDrop 一处。
 */
export function useItemDragStart({
  item,
  cabinets,
  currentCabinetId,
  dragItemIds,
  onToggleFavorite,
  onSetFavorites,
  onAddItemToCabinet,
  onAddItemsToCabinet,
  onClearCurrentFilter,
  onClearCurrentFilters,
  onRequestRemoveFromApp,
  onRequestBatchRemoveFromApp,
}: ItemDragStartOptions) {
  const itemIds = dragItemIds && dragItemIds.length > 0 ? dragItemIds : [item.id];
  const cabinetName = (cabinetId: number) =>
    cabinets.find((cabinet) => cabinet.id === cabinetId)?.name ?? "文件柜";

  return (event: React.PointerEvent<HTMLElement>) => {
    beginInternalPointerDrag({
      event,
      payload: { kind: "item", itemId: item.id, label: item.name, itemIds },
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
          if (itemIds.length > 1 && onSetFavorites) {
            await onSetFavorites(itemIds, true);
            showToast(`已收藏 ${itemIds.length} 项`, "success");
            return;
          }
          // 已收藏时拖到收藏区不再静默无效
          if (!item.is_favorite) {
            await onToggleFavorite();
            showToast(`已收藏「${item.name}」`, "success");
          } else {
            showToast(`「${item.name}」已在收藏中`, "info");
          }
          return;
        }
        if (target?.kind === "item-cabinet") {
          // 前端可确定的重复（单拖到当前所在柜）直接提示，不发请求
          if (itemIds.length === 1 && target.cabinetId === currentCabinetId) {
            showToast(`「${item.name}」已在此文件柜中`, "info");
            return;
          }
          if (itemIds.length > 1 && onAddItemsToCabinet) {
            await onAddItemsToCabinet(target.cabinetId, itemIds);
            showToast(`已加入文件柜「${cabinetName(target.cabinetId)}」（${itemIds.length} 项）`, "success");
            return;
          }
          await onAddItemToCabinet(target.cabinetId, item.id);
          showToast(`已加入文件柜「${cabinetName(target.cabinetId)}」`, "success");
          return;
        }
        if (target?.kind === "item-clear-current-filter") {
          if (itemIds.length > 1 && onClearCurrentFilters) {
            await onClearCurrentFilters(itemIds);
            return;
          }
          for (const id of itemIds) {
            await onClearCurrentFilter(id);
          }
          return;
        }
        if (target?.kind === "item-remove-from-app") {
          if (itemIds.length > 1 && onRequestBatchRemoveFromApp) {
            await onRequestBatchRemoveFromApp();
            return;
          }
          await onRequestRemoveFromApp(item.id);
        }
      },
    });
  };
}

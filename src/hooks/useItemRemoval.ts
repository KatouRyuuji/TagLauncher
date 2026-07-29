// ============================================================================
// hooks/useItemRemoval.ts — 对象移除确认流（单个 / 批量）
// ============================================================================
// 统一"从应用移除对象"的确认交互：读取 localStorage 的"本次跳过"标记，
// 需要确认时挂起待删集合并交由 RemoveFromAppConfirmDialog 渲染，确认后落库
// 并把被删 id 从选中集清除。单个走 removeItem、批量走 removeItems，行为与
// 抽离前 App.tsx 完全一致。
// ============================================================================

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

const SKIP_REMOVE_ITEM_CONFIRM_KEY = "taglauncher.skip_remove_item_confirm";

interface UseItemRemovalParams {
  removeItem: (id: number) => Promise<void>;
  removeItems: (ids: number[]) => Promise<void>;
  selectedItemIds: number[];
  setSelectedItemIds: Dispatch<SetStateAction<number[]>>;
}

export interface RemoveConfirmDialogProps {
  open: boolean;
  itemCount: number;
  skipNextTime: boolean;
  onSkipNextTimeChange: (v: boolean) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export interface UseItemRemovalResult {
  /** 请求移除单个对象（可能直接删除或弹确认）。 */
  requestRemoveFromApp: (itemId: number) => Promise<void>;
  /** 请求批量移除当前选中对象（可能直接删除或弹确认）。 */
  requestBatchRemoveFromApp: () => Promise<void>;
  /** 直接展开给 RemoveFromAppConfirmDialog 的 props。 */
  removeDialog: RemoveConfirmDialogProps;
}

export function useItemRemoval({
  removeItem,
  removeItems,
  selectedItemIds,
  setSelectedItemIds,
}: UseItemRemovalParams): UseItemRemovalResult {
  const [pendingRemoveItemId, setPendingRemoveItemId] = useState<number | null>(null);
  const [pendingBatchRemoveItemIds, setPendingBatchRemoveItemIds] = useState<number[] | null>(null);
  const [skipRemoveItemConfirm, setSkipRemoveItemConfirm] = useState(false);

  const requestRemoveFromApp = useCallback(
    async (itemId: number) => {
      let skipConfirm = false;
      try {
        skipConfirm = localStorage.getItem(SKIP_REMOVE_ITEM_CONFIRM_KEY) === "1";
      } catch {
        skipConfirm = false;
      }

      if (skipConfirm) {
        await removeItem(itemId);
        setSelectedItemIds((current) => current.filter((id) => id !== itemId));
        return;
      }

      setSkipRemoveItemConfirm(false);
      setPendingRemoveItemId(itemId);
    },
    [removeItem, setSelectedItemIds],
  );

  const requestBatchRemoveFromApp = useCallback(async () => {
    if (selectedItemIds.length === 0) return;

    let skipConfirm = false;
    try {
      skipConfirm = localStorage.getItem(SKIP_REMOVE_ITEM_CONFIRM_KEY) === "1";
    } catch {
      skipConfirm = false;
    }

    if (skipConfirm) {
      await removeItems(selectedItemIds);
      setSelectedItemIds([]);
      return;
    }

    setSkipRemoveItemConfirm(false);
    setPendingBatchRemoveItemIds(selectedItemIds);
  }, [removeItems, selectedItemIds, setSelectedItemIds]);

  const handleConfirmRemoveFromApp = useCallback(async () => {
    const itemIds = pendingBatchRemoveItemIds ?? (pendingRemoveItemId === null ? [] : [pendingRemoveItemId]);
    if (itemIds.length === 0) return;

    try {
      if (skipRemoveItemConfirm) {
        localStorage.setItem(SKIP_REMOVE_ITEM_CONFIRM_KEY, "1");
      }
    } catch {
      // ignore storage failures
    }

    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    setSkipRemoveItemConfirm(false);
    await removeItems(itemIds);
    setSelectedItemIds((current) => current.filter((itemId) => !itemIds.includes(itemId)));
  }, [pendingBatchRemoveItemIds, pendingRemoveItemId, removeItems, skipRemoveItemConfirm, setSelectedItemIds]);

  const handleCancelRemoveFromApp = useCallback(() => {
    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    setSkipRemoveItemConfirm(false);
  }, []);

  return {
    requestRemoveFromApp,
    requestBatchRemoveFromApp,
    removeDialog: {
      open: pendingRemoveItemId !== null || pendingBatchRemoveItemIds !== null,
      itemCount: pendingBatchRemoveItemIds?.length ?? 1,
      skipNextTime: skipRemoveItemConfirm,
      onSkipNextTimeChange: setSkipRemoveItemConfirm,
      onConfirm: handleConfirmRemoveFromApp,
      onCancel: handleCancelRemoveFromApp,
    },
  };
}

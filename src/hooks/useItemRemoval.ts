// ============================================================================
// hooks/useItemRemoval.ts — 对象移除确认流（单个 / 批量）
// ============================================================================
// 统一"从应用移除对象"的确认交互：读取 localStorage 的"本次跳过"标记，
// 需要确认时挂起待删集合并交由 RemoveFromAppConfirmDialog 渲染，确认后落库
// 并把被删 id 从选中集清除。单个与批量统一走 removeItems 原子批量命令，
// 不再单删/批量两条路径落到不同后端命令。
// ============================================================================

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

const SKIP_REMOVE_ITEM_CONFIRM_KEY = "taglauncher.skip_remove_item_confirm";

interface UseItemRemovalParams {
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
        await removeItems([itemId]);
        setSelectedItemIds((current) => current.filter((id) => id !== itemId));
        return;
      }

      setSkipRemoveItemConfirm(false);
      setPendingRemoveItemId(itemId);
    },
    [removeItems, setSelectedItemIds],
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

    // 乐观关闭对话框；失败提示由 removeItems 内部 withErrorToast 统一弹出，
    // 这里捕获 rejection 只是为了不产生未处理的 Promise 拒绝。
    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    try {
      await removeItems(itemIds);
    } catch {
      // 移除失败：不写入"下次跳过"偏好、不清选中集，便于用户修正后重试
      setSkipRemoveItemConfirm(false);
      return;
    }

    // 移除成功后才持久化"本次不再确认"偏好，避免失败操作污染偏好
    try {
      if (skipRemoveItemConfirm) {
        localStorage.setItem(SKIP_REMOVE_ITEM_CONFIRM_KEY, "1");
      }
    } catch {
      // ignore storage failures
    }

    setSkipRemoveItemConfirm(false);
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

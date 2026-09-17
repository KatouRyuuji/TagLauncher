// ============================================================================
// hooks/useItemRemoval.ts — 对象移除确认流（单个 / 批量）
// ============================================================================
// 统一"从应用移除对象"的确认交互：读取 localStorage 的"本次跳过"标记，
// 需要确认时挂起待删集合并交由 RemoveFromAppConfirmDialog 渲染，确认后落库
// 并把被删 id 从选中集清除。单个与批量统一走 removeItems 原子批量命令，
// 不再单删/批量两条路径落到不同后端命令。
// 「下次不再确认」只作用于仅出库；删除本地文件始终弹确认。
// ============================================================================

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

const SKIP_REMOVE_ITEM_CONFIRM_KEY = "taglauncher.skip_remove_item_confirm";

/** 请求批量移除当前选中集事件：ContextMenu 多选删除走此通道（拿不到本 hook 的回调）。 */
export const BATCH_REMOVE_REQUEST_EVENT = "taglauncher-request-batch-remove";

export type RemoveFromAppMode = "library" | "files";

export interface RemoveConfirmItem {
  name: string;
  path: string;
  type: string;
}

export interface RemoveItemsOptions {
  deleteFiles?: boolean;
}

interface UseItemRemovalParams {
  removeItems: (ids: number[], options?: RemoveItemsOptions) => Promise<void>;
  selectedItemIds: number[];
  setSelectedItemIds: Dispatch<SetStateAction<number[]>>;
  items: Array<{ id: number; name: string; path: string; type: string }>;
}

export interface RemoveRequestOptions {
  forceDialog?: boolean;
  preferDeleteFiles?: boolean;
}

export interface RemoveConfirmDialogProps {
  open: boolean;
  items: RemoveConfirmItem[];
  skipNextTime: boolean;
  preferDeleteFiles: boolean;
  onSkipNextTimeChange: (v: boolean) => void;
  onConfirm: (mode: RemoveFromAppMode) => Promise<void>;
  onCancel: () => void;
}

export interface UseItemRemovalResult {
  /** 请求移除单个对象（可能直接删除或弹确认）。 */
  requestRemoveFromApp: (itemId: number, options?: RemoveRequestOptions) => Promise<void>;
  /** 请求批量移除当前选中对象（可能直接删除或弹确认）。 */
  requestBatchRemoveFromApp: (options?: RemoveRequestOptions) => Promise<void>;
  /** 直接展开给 RemoveFromAppConfirmDialog 的 props。 */
  removeDialog: RemoveConfirmDialogProps;
}

function readSkipConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_REMOVE_ITEM_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

export function useItemRemoval({
  removeItems,
  selectedItemIds,
  setSelectedItemIds,
  items,
}: UseItemRemovalParams): UseItemRemovalResult {
  const [pendingRemoveItemId, setPendingRemoveItemId] = useState<number | null>(null);
  const [pendingBatchRemoveItemIds, setPendingBatchRemoveItemIds] = useState<number[] | null>(null);
  const [skipRemoveItemConfirm, setSkipRemoveItemConfirm] = useState(false);
  const [preferDeleteFiles, setPreferDeleteFiles] = useState(false);

  const commitRemove = useCallback(
    async (itemIds: number[], deleteFiles: boolean) => {
      await removeItems(itemIds, { deleteFiles });
      setSelectedItemIds((current) => current.filter((id) => !itemIds.includes(id)));
    },
    [removeItems, setSelectedItemIds],
  );

  const requestRemoveFromApp = useCallback(
    async (itemId: number, options?: RemoveRequestOptions) => {
      const skipConfirm = !options?.forceDialog && !options?.preferDeleteFiles && readSkipConfirm();
      if (skipConfirm) {
        await commitRemove([itemId], false);
        return;
      }

      setSkipRemoveItemConfirm(false);
      setPreferDeleteFiles(options?.preferDeleteFiles === true);
      setPendingRemoveItemId(itemId);
    },
    [commitRemove],
  );

  const requestBatchRemoveFromApp = useCallback(async (options?: RemoveRequestOptions) => {
    if (selectedItemIds.length === 0) return;

    const skipConfirm = !options?.forceDialog && !options?.preferDeleteFiles && readSkipConfirm();
    if (skipConfirm) {
      await commitRemove(selectedItemIds, false);
      return;
    }

    setSkipRemoveItemConfirm(false);
    setPreferDeleteFiles(options?.preferDeleteFiles === true);
    setPendingBatchRemoveItemIds(selectedItemIds);
  }, [commitRemove, selectedItemIds]);

  const handleConfirmRemoveFromApp = useCallback(async (mode: RemoveFromAppMode) => {
    const itemIds = pendingBatchRemoveItemIds ?? (pendingRemoveItemId === null ? [] : [pendingRemoveItemId]);
    if (itemIds.length === 0) return;

    const deleteFiles = mode === "files";
    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    try {
      await commitRemove(itemIds, deleteFiles);
    } catch {
      setSkipRemoveItemConfirm(false);
      setPreferDeleteFiles(false);
      return;
    }

    try {
      if (skipRemoveItemConfirm && !deleteFiles) {
        localStorage.setItem(SKIP_REMOVE_ITEM_CONFIRM_KEY, "1");
      }
    } catch {
      // ignore storage failures
    }

    setSkipRemoveItemConfirm(false);
    setPreferDeleteFiles(false);
  }, [commitRemove, pendingBatchRemoveItemIds, pendingRemoveItemId, skipRemoveItemConfirm]);

  const handleCancelRemoveFromApp = useCallback(() => {
    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    setSkipRemoveItemConfirm(false);
    setPreferDeleteFiles(false);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { deleteFiles?: boolean } | undefined : undefined;
      const deleteFiles = detail?.deleteFiles === true;
      void requestBatchRemoveFromApp({
        forceDialog: deleteFiles,
        preferDeleteFiles: deleteFiles,
      });
    };
    window.addEventListener(BATCH_REMOVE_REQUEST_EVENT, handler);
    return () => window.removeEventListener(BATCH_REMOVE_REQUEST_EVENT, handler);
  }, [requestBatchRemoveFromApp]);

  const pendingItems = useMemo(() => {
    const ids = pendingBatchRemoveItemIds ?? (pendingRemoveItemId === null ? [] : [pendingRemoveItemId]);
    const byId = new Map(items.map((item) => [item.id, item]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [{ name: item.name, path: item.path, type: item.type }] : [];
    });
  }, [items, pendingBatchRemoveItemIds, pendingRemoveItemId]);

  return {
    requestRemoveFromApp,
    requestBatchRemoveFromApp,
    removeDialog: {
      open: pendingRemoveItemId !== null || pendingBatchRemoveItemIds !== null,
      items: pendingItems,
      skipNextTime: skipRemoveItemConfirm,
      preferDeleteFiles,
      onSkipNextTimeChange: setSkipRemoveItemConfirm,
      onConfirm: handleConfirmRemoveFromApp,
      onCancel: handleCancelRemoveFromApp,
    },
  };
}

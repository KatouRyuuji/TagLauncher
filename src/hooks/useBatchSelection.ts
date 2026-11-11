// ============================================================================
// hooks/useBatchSelection.ts — 复选集合的批量动作
// ============================================================================
// 选中对象由调用方按 ID 取齐（分页视图下可能含未缓存的对象）后传入，提供批量加/移标签、批量
// 加入/移出文件柜四类动作，以及"选中对象可移除标签并集"（供工具条渲染）。
// 批量写走后端一次事务（setManyItemTags / *ItemsToCabinet）。
// 从 App.tsx 抽离，行为完全保持一致。
// ============================================================================

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";

interface UseBatchSelectionParams {
  /** 选中对象（按视图顺序、已取齐） */
  selectedItems: ItemWithTags[];
  selectedItemIds: number[];
  setSelectedItemIds: Dispatch<SetStateAction<number[]>>;
  setManyItemTags: (changes: Array<{ itemId: number; tagIds: number[] }>) => Promise<void>;
  addItemsToCabinet: (cabinetId: number, itemIds: number[]) => Promise<void>;
  removeItemsFromCabinet: (cabinetId: number, itemIds: number[]) => Promise<void>;
}

export interface UseBatchSelectionResult {
  /** 当前选中的对象（含各自 tags；供工具条计算「全有 / 部分有」）。 */
  selectedItems: ItemWithTags[];
  /** 选中对象实际拥有标签的并集（供"移除标签"菜单）。 */
  selectedItemsTags: Array<{ id: number; name: string; color: string }>;
  batchAddTag: (tagId: number) => Promise<void>;
  batchRemoveTag: (tagId: number) => Promise<void>;
  batchAddToCabinet: (cabinetId: number) => Promise<void>;
  batchRemoveFromCabinet: () => Promise<void>;
}

export function useBatchSelection({
  selectedItems,
  selectedItemIds,
  setSelectedItemIds,
  setManyItemTags,
  addItemsToCabinet,
  removeItemsFromCabinet,
}: UseBatchSelectionParams): UseBatchSelectionResult {
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);

  const selectedItemsTags = useMemo(() => {
    const seen = new Set<number>();
    const result: Array<{ id: number; name: string; color: string }> = [];
    for (const item of selectedItems) {
      for (const tag of item.tags) {
        if (seen.has(tag.id)) continue;
        seen.add(tag.id);
        result.push({ id: tag.id, name: tag.name, color: tag.color });
      }
    }
    return result;
  }, [selectedItems]);

  const batchAddTag = useCallback(async (tagId: number) => {
    await setManyItemTags(
      selectedItems.flatMap((item) => {
        const currentTagIds = item.tags.map((tag) => tag.id);
        return currentTagIds.includes(tagId)
          ? []
          : [{ itemId: item.id, tagIds: [...currentTagIds, tagId] }];
      }),
    );
  }, [selectedItems, setManyItemTags]);

  const batchRemoveTag = useCallback(async (tagId: number) => {
    await setManyItemTags(
      selectedItems.flatMap((item) => {
        const currentTagIds = item.tags.map((tag) => tag.id);
        return currentTagIds.includes(tagId)
          ? [{ itemId: item.id, tagIds: currentTagIds.filter((currentTagId) => currentTagId !== tagId) }]
          : [];
      }),
    );
  }, [selectedItems, setManyItemTags]);

  const batchAddToCabinet = useCallback(async (cabinetId: number) => {
    await addItemsToCabinet(cabinetId, selectedItemIds);
  }, [addItemsToCabinet, selectedItemIds]);

  const batchRemoveFromCabinet = useCallback(async () => {
    if (selectedCabinetId === null) return;

    await removeItemsFromCabinet(selectedCabinetId, selectedItemIds);
    setSelectedItemIds([]);
  }, [removeItemsFromCabinet, selectedCabinetId, selectedItemIds, setSelectedItemIds]);

  return { selectedItems, selectedItemsTags, batchAddTag, batchRemoveTag, batchAddToCabinet, batchRemoveFromCabinet };
}

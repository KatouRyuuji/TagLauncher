// ============================================================================
// hooks/useItemTagActions.ts — 单对象标签动作
// ============================================================================
// 承载"对单个对象增删标签 / 新建并追加标签 / 清除当前筛选归类"四类动作。
// 新建标签的重名查找直接读 store 最新态（大小写不敏感匹配，与 AI 打标路径一致），
// 回调仅依赖稳定的原语，引用稳定，避免击穿下游 viewProps memo。
// 从 App.tsx 抽离，行为完全保持一致。
// ============================================================================

import { useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { pickRandomTagColor } from "../lib/tagColors";
import type { ItemWithTags, Tag } from "../types";

interface UseItemTagActionsParams {
  findItemById: (itemId: number) => ItemWithTags | undefined;
  setItemTags: (itemId: number, tagIds: number[]) => Promise<void>;
  addTag: (name: string, color: string) => Promise<Tag>;
  removeItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
}

export interface UseItemTagActionsResult {
  addTagToItem: (itemId: number, tagId: number) => Promise<void>;
  removeTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  addNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  clearCurrentFilter: (itemId: number) => Promise<void>;
}

export function useItemTagActions({
  findItemById,
  setItemTags,
  addTag,
  removeItemFromCabinet,
}: UseItemTagActionsParams): UseItemTagActionsResult {
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);

  const addTagToItem = useCallback(
    async (itemId: number, tagId: number) => {
      const item = findItemById(itemId);
      if (!item) return;

      const existing = item.tags.map((t) => t.id);
      if (existing.includes(tagId)) return;

      await setItemTags(itemId, [...existing, tagId]);
    },
    [findItemById, setItemTags],
  );

  const removeTagFromItem = useCallback(
    async (itemId: number, tagId: number) => {
      const item = findItemById(itemId);
      if (!item) return;

      await setItemTags(
        itemId,
        item.tags.filter((t) => t.id !== tagId).map((t) => t.id),
      );
    },
    [findItemById, setItemTags],
  );

  // 新建（或复用同名）标签并把它并入 baseTagIds，返回合并后的 id 列表——
  // 仅创建 Tag 记录、不立即写入对象标签。调用方（标签编辑器）负责在「保存」时统一落库，
  // 避免"新建标签即刻应用、点取消却已生效"的不一致。
  const addNewTagToItem = useCallback(
    async (itemId: number, tagName: string, baseTagIds?: number[]): Promise<number[]> => {
      const normalizedName = tagName.trim();
      if (!normalizedName) {
        return baseTagIds ?? [];
      }

      // 大小写不敏感复用：与 AI 打标路径（useAiTagOrchestration.ensureTagByName）一致——
      // DB 的 tags.name UNIQUE 是 BINARY 大小写敏感，精确匹配会造出 "Dev"/"dev" 并存标签。
      const existingTag = useAppStore
        .getState()
        .tags.find((t) => t.name.toLowerCase() === normalizedName.toLowerCase());
      let tagId: number;

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const newTag = await addTag(normalizedName, pickRandomTagColor());
        tagId = newTag.id;
      }

      const item = findItemById(itemId);
      const currentTagIds = item ? item.tags.map((t) => t.id) : [];
      const sourceTagIds = baseTagIds ?? currentTagIds;
      return Array.from(new Set([...sourceTagIds, tagId]));
    },
    [addTag, findItemById],
  );

  const clearCurrentFilter = useCallback(
    async (itemId: number) => {
      const item = findItemById(itemId);
      if (!item) return;

      if (selectedTagIds.length > 0) {
        const activeTagIds = new Set(selectedTagIds);
        const nextTagIds = item.tags
          .filter((tag) => !activeTagIds.has(tag.id))
          .map((tag) => tag.id);
        if (nextTagIds.length !== item.tags.length) {
          await setItemTags(itemId, nextTagIds);
        }
        return;
      }

      if (selectedCabinetId !== null) {
        await removeItemFromCabinet(selectedCabinetId, itemId);
      }
    },
    [findItemById, removeItemFromCabinet, selectedCabinetId, selectedTagIds, setItemTags],
  );

  return { addTagToItem, removeTagFromItem, addNewTagToItem, clearCurrentFilter };
}

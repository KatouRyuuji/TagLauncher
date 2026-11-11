// ============================================================================
// hooks/useTagItems.ts — 某个标签直接关联的对象（标签图谱 / 关系编辑器的右侧列表）
// ----------------------------------------------------------------------------
// 前端不持有全量对象：由后端视图查询按「直接打了该标签」取全部 ID（含夹内对象，
// smart 顺序），只取前 limit 个对象的数据；数据代变化时重取。
// ============================================================================
import { useEffect, useState } from "react";
import * as db from "../lib/db";
import type { ItemWithTags } from "../types";

export function tagItemsArgs(tagId: number): db.ViewQueryArgs {
  return {
    scope: "all",
    cabinetId: null,
    selectedGroups: [[tagId]],
    excludedGroups: [],
    typeFilter: "all",
    hideMissing: false,
    sortMode: "smart",
    showNestedContents: true,
    libraryBrowseRoot: null,
    libraryBrowseDir: null,
    cabinetDir: null,
    cabinetFlat: true,
    query: "",
    mode: "all",
    refreeze: false,
  };
}

export function useTagItems(
  tagId: number | null,
  limit: number,
  dataEpoch: number,
): { count: number; items: ItemWithTags[] } {
  const [result, setResult] = useState<{ count: number; items: ItemWithTags[] }>({ count: 0, items: [] });
  useEffect(() => {
    if (tagId === null) {
      setResult({ count: 0, items: [] });
      return;
    }
    let cancelled = false;
    void db
      .viewQuery(tagItemsArgs(tagId))
      .then(async ({ ids }) => {
        const items = ids.length === 0 ? [] : await db.getItemsByIds(ids.slice(0, limit));
        if (!cancelled) setResult({ count: ids.length, items });
      })
      .catch((error: unknown) => {
        console.error("读取标签关联对象失败:", error);
        if (!cancelled) setResult({ count: 0, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tagId, limit, dataEpoch]);
  return result;
}

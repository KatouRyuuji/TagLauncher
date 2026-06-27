// ============================================================================
// hooks/useTagRelations.ts — 标签父子关系（DAG）管理
// ============================================================================
// 从后端加载关系边到 appStore.tagRelations，并提供增删。
// 新增关系若形成自环/循环会被后端拒绝（抛错，由调用方捕获提示）。
// 关系数据由 store 共享给：筛选后代闭包、侧栏标注、独立图视图。
// 标签集合（tags）变化时自动重载，覆盖"删除标签级联删边"的情况。
// ============================================================================

import { useCallback, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";

export function useTagRelations() {
  const relations = useAppStore((s) => s.tagRelations);
  const setTagRelations = useAppStore((s) => s.setTagRelations);
  const tags = useAppStore((s) => s.tags);

  const reload = useCallback(async () => {
    try {
      setTagRelations(await db.getTagRelations());
    } catch (e) {
      console.error("加载标签关系失败:", e);
    }
  }, [setTagRelations]);

  useEffect(() => {
    void reload();
  }, [reload, tags]);

  const addRelation = useCallback(
    async (parentId: number, childId: number) => {
      await db.addTagRelation(parentId, childId);
      await reload();
    },
    [reload],
  );

  const removeRelation = useCallback(
    async (parentId: number, childId: number) => {
      await db.removeTagRelation(parentId, childId);
      await reload();
    },
    [reload],
  );

  return { relations, addRelation, removeRelation, reload };
}

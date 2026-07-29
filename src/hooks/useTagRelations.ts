// ============================================================================
// hooks/useTagRelations.ts — 标签父子关系（DAG）管理
// ============================================================================
// 从后端加载关系边到 appStore.tagRelations，并提供增删。
// 新增关系若形成自环/循环会被后端拒绝（抛错，由调用方捕获提示）。
// 关系数据由 store 共享给：筛选后代闭包、侧栏标注、独立图视图。
// 首次挂载加载一次；此后仅当有标签被删除（后端级联删边）时重载——新增/改名标签
// 不影响关系边，无需多余的 IPC 往返。
// ============================================================================

import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";

export function useTagRelations() {
  const relations = useAppStore((s) => s.tagRelations);
  const setTagRelations = useAppStore((s) => s.setTagRelations);
  const tags = useAppStore((s) => s.tags);
  const prevTagIdsRef = useRef<Set<number> | null>(null);

  const reload = useCallback(async () => {
    try {
      setTagRelations(await db.getTagRelations());
    } catch (e) {
      console.error("加载标签关系失败:", e);
    }
  }, [setTagRelations]);

  useEffect(() => {
    const currentIds = new Set(tags.map((t) => t.id));
    const prev = prevTagIdsRef.current;
    prevTagIdsRef.current = currentIds;

    // 首次挂载：无条件加载一次（关系边独立于标签是否已装载）。
    if (prev === null) {
      void reload();
      return;
    }
    // 之后仅当有旧标签 id 消失（删除，可能触发级联删边）时才重载。
    for (const id of prev) {
      if (!currentIds.has(id)) {
        void reload();
        return;
      }
    }
  }, [tags, reload]);

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

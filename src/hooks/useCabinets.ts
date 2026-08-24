// ============================================================================
// hooks/useCabinets.ts — 文件柜数据管理 Hook
// ============================================================================
// 封装文件柜的 CRUD 操作，每次操作后自动刷新文件柜列表。
// 文件柜数据存储在 Zustand Store 中，供 Sidebar 和右键菜单使用。
// ============================================================================

import { useEffect, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { notifyCabinetsChanged } from "../lib/modApi";
import { compareNames } from "../lib/itemQuery";
import type { Cabinet } from "../types";

/** 按名称排序，保持与后端 get_cabinets 的返回顺序一致 */
function sortCabinets(list: Cabinet[]): Cabinet[] {
  return [...list].sort((a, b) => compareNames(a.name, b.name));
}

export function useCabinets() {
  const setCabinets = useAppStore((state) => state.setCabinets);

  /** 从后端加载所有文件柜并写入 Store */
  const loadCabinets = useCallback(async () => {
    try {
      const data = await db.getCabinets();
      setCabinets(data);
      notifyCabinetsChanged(data);
    } catch (e) {
      console.error("Failed to load cabinets:", e);
    }
  }, [setCabinets]);

  // 初始加载
  useEffect(() => {
    loadCabinets();
  }, [loadCabinets]);

  /** 新建文件柜 */
  const addCabinet = useCallback(async (name: string, color: string) => {
    const cab = await db.addCabinet(name, color);
    // 局部更新：把后端返回的文件柜追加进 store 并按名称排序
    const next = sortCabinets([...useAppStore.getState().cabinets, cab]);
    setCabinets(next);
    notifyCabinetsChanged(next);
    return cab;
  }, [setCabinets]);

  /** 更新文件柜名称和颜色 */
  const updateCabinet = useCallback(async (id: number, name: string, color: string) => {
    await db.updateCabinet(id, name, color);
    // 局部更新：按 id 替换后重新排序（保留 created_at）
    const next = sortCabinets(
      useAppStore.getState().cabinets.map((c) => (c.id === id ? { ...c, name, color } : c)),
    );
    setCabinets(next);
    notifyCabinetsChanged(next);
  }, [setCabinets]);

  /** 删除文件柜（关联的 cabinet_items 记录会级联删除） */
  const removeCabinet = useCallback(async (id: number) => {
    await db.removeCabinet(id);
    // 局部更新：按 id 过滤
    const next = useAppStore.getState().cabinets.filter((c) => c.id !== id);
    setCabinets(next);
    notifyCabinetsChanged(next);
    // 若删除的是当前选中文件柜，清除选中状态避免幽灵筛选
    if (useAppStore.getState().selectedCabinetId === id) {
      useAppStore.getState().setSelectedCabinetId(null);
    }
  }, [setCabinets]);

  return { refresh: loadCabinets, addCabinet, updateCabinet, removeCabinet };
}

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

export function useCabinets() {
  const { setCabinets } = useAppStore();

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
  const addCabinet = async (name: string, color: string) => {
    const cab = await db.addCabinet(name, color);
    await loadCabinets();
    return cab;
  };

  /** 更新文件柜名称和颜色 */
  const updateCabinet = async (id: number, name: string, color: string) => {
    await db.updateCabinet(id, name, color);
    await loadCabinets();
  };

  /** 删除文件柜（关联的 cabinet_items 记录会级联删除） */
  const removeCabinet = async (id: number) => {
    await db.removeCabinet(id);
    await loadCabinets();
  };

  return { refresh: loadCabinets, addCabinet, updateCabinet, removeCabinet };
}

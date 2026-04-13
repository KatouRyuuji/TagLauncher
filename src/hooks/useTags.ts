// ============================================================================
// hooks/useTags.ts — 标签数据管理 Hook
// ============================================================================
// 封装标签的 CRUD 操作，每次操作后自动刷新标签列表。
// 标签数据存储在 Zustand Store 中，供 Sidebar、TagFilterBar 等组件使用。
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";

export function useTags() {
  const { tags, setTags } = useAppStore();
  const [loading, setLoading] = useState(true);

  /** 从后端加载所有标签并写入 Store */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getTags();
      setTags(data);
    } catch (e) {
      console.error("Failed to load tags:", e);
    } finally {
      setLoading(false);
    }
  }, [setTags]);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 新建标签，返回创建的 Tag 对象（含自增 ID） */
  const addTag = async (name: string, color: string) => {
    const tag = await db.addTag(name, color);
    await refresh();
    return tag;
  };

  /** 更新标签名称和颜色 */
  const updateTag = async (id: number, name: string, color: string) => {
    await db.updateTag(id, name, color);
    await refresh();
  };

  /** 删除标签（关联的 item_tags 记录会级联删除） */
  const removeTag = async (id: number) => {
    await db.removeTag(id);
    await refresh();
  };

  return { tags, loading, refresh, addTag, updateTag, removeTag };
}

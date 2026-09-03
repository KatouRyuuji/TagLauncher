// ============================================================================
// hooks/useTags.ts — 标签数据管理 Hook
// ============================================================================
// 封装标签的 CRUD 操作，每次操作后自动刷新标签列表。
// 标签数据存储在 Zustand Store 中，供 Sidebar、SearchBar 等组件使用。
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { notifyTagsChanged } from "../lib/modApi";
import { compareNames } from "../lib/itemQuery";
import { showToast } from "../lib/toast";
import type { Tag } from "../types";

/** 按名称排序，保持与后端 get_tags 的返回顺序一致 */
function sortTags(list: Tag[]): Tag[] {
  return [...list].sort((a, b) => compareNames(a.name, b.name));
}

export function useTags() {
  const tags = useAppStore((state) => state.tags);
  const setTags = useAppStore((state) => state.setTags);
  const [loading, setLoading] = useState(true);

  /** 从后端加载所有标签并写入 Store */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getTags();
      setTags(data);
      notifyTagsChanged(data);
    } catch (e) {
      console.error("Failed to load tags:", e);
      // 后端故障不得静默呈现为「暂无标签」假象（对齐 useItems 的错误提示范式）
      showToast(`加载标签失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [setTags]);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 以下 CRUD 用 useCallback 保持引用稳定（仅依赖稳定的 setTags），
  // 避免向下传递时（如 App 的 handleAddNewTagToItem → viewProps）引发整列表重渲染。
  // 内部均以 useAppStore.getState() 读取最新 tags，无过期闭包风险。

  /** 新建标签，返回创建的 Tag 对象（含自增 ID） */
  const addTag = useCallback(async (name: string, color: string) => {
    const tag = await db.addTag(name, color);
    // 局部更新：把后端返回的 tag 追加进 store 并按名称排序
    const next = sortTags([...useAppStore.getState().tags, tag]);
    setTags(next);
    notifyTagsChanged(next);
    return tag;
  }, [setTags]);

  /** 更新标签名称和颜色 */
  const updateTag = useCallback(async (id: number, name: string, color: string) => {
    await db.updateTag(id, name, color);
    // 局部更新：按 id 替换后重新排序
    const next = sortTags(
      useAppStore.getState().tags.map((t) => (t.id === id ? { ...t, name, color } : t)),
    );
    setTags(next);
    notifyTagsChanged(next);
  }, [setTags]);

  /** 删除标签（关联的 item_tags 记录会级联删除） */
  const removeTag = useCallback(async (id: number) => {
    await db.removeTag(id);
    // 局部更新：按 id 过滤
    const next = useAppStore.getState().tags.filter((t) => t.id !== id);
    setTags(next);
    notifyTagsChanged(next);
    // 若删除的标签在筛选中，同步移除避免幽灵筛选
    const { selectedTagIds, setSelectedTagIds } = useAppStore.getState();
    if (selectedTagIds.includes(id)) {
      setSelectedTagIds(selectedTagIds.filter((tagId) => tagId !== id));
    }
  }, [setTags]);

  return { tags, loading, refresh, addTag, updateTag, removeTag };
}

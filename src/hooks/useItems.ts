import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { buildSearchIndex, filterItemsByTags, searchWithIndex } from "../lib/search";
import { buildDescendantsMap } from "../lib/tagGraph";
import { notifyItemLaunched, notifyItemsChanged, notifyCabinetItemsChanged } from "../lib/modApi";
import type { ItemWithTags } from "../types";

function showToast(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", { detail: { message, type } }),
  );
}

/**
 * 写操作错误反馈包装：失败时弹出可读 toast 再向上抛出。
 * 保持原行为——本地乐观更新只在写成功后进行，失败抛出即跳过本地更新。
 */
async function withErrorToast<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    showToast(`${action}失败：${detail}`, "error");
    throw e;
  }
}

function getPathDisplayName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function sortItems(items: ItemWithTags[]): ItemWithTags[] {
  return [...items].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;

    const aUsed = a.last_used_at ?? "";
    const bUsed = b.last_used_at ?? "";
    if (aUsed !== bUsed) return bUsed.localeCompare(aUsed);

    return a.name.localeCompare(b.name);
  });
}

function upsertItem(items: ItemWithTags[], item: ItemWithTags): ItemWithTags[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) {
    return sortItems([...items, item]);
  }

  const next = [...items];
  next[index] = item;
  return sortItems(next);
}

function upsertItems(items: ItemWithTags[], changedItems: ItemWithTags[]): ItemWithTags[] {
  if (changedItems.length === 0) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of changedItems) {
    byId.set(item.id, item);
  }

  return sortItems(Array.from(byId.values()));
}

function removeItemFromList(items: ItemWithTags[], id: number): ItemWithTags[] {
  return items.filter((item) => item.id !== id);
}

export function useItems() {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchMode = useAppStore((state) => state.searchMode);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [allItems, setAllItems] = useState<ItemWithTags[]>([]);
  const [cabinetItems, setCabinetItems] = useState<ItemWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const allItemsRef = useRef<ItemWithTags[]>([]);
  const cabinetItemsRef = useRef<ItemWithTags[]>([]);
  const relocatingRef = useRef(false);
  const relocateMissingRef = useRef<() => void>(() => {});

  useEffect(() => {
    allItemsRef.current = allItems;
    notifyItemsChanged(allItems);
  }, [allItems]);

  useEffect(() => {
    cabinetItemsRef.current = cabinetItems;
  }, [cabinetItems]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // 记录刷新前的失效态，用于检测"本次新变为失效"的对象并主动提示
      const prev = new Map(allItemsRef.current.map((i) => [i.id, i]));
      const data = await db.getItems();
      setAllItems(data);

      const newlyMissing = data.filter(
        (i) => i.is_missing && prev.has(i.id) && !prev.get(i.id)?.is_missing,
      );
      if (newlyMissing.length > 0) {
        const names = newlyMissing
          .slice(0, 3)
          .map((i) => i.name)
          .join("、");
        const suffix = newlyMissing.length > 3 ? ` 等 ${newlyMissing.length} 个` : "";
        showToast(
          `${newlyMissing.length} 个对象的文件已丢失或移动到其他磁盘：${names}${suffix}（归类已保留，文件恢复后会自动重新关联）`,
          "warning",
        );
        // 兜底：后台按内容签名尝试跨盘找回（扫描在后端 DB 锁外执行，不阻塞）。
        relocateMissingRef.current();
      }
    } catch (e) {
      console.error("Failed to load items:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 跨盘符兜底找回：对失效对象按内容签名扫描候选盘，命中则刷新并提示。
  // 用 relocatingRef 防止并发/重复扫描；成功找回 0 个时保持安静。
  const relocateMissing = useCallback(async (): Promise<number> => {
    if (relocatingRef.current) return 0;
    relocatingRef.current = true;
    try {
      const recovered = await db.relocateMissing();
      if (recovered > 0) {
        await loadAll();
        showToast(`已跨盘找回 ${recovered} 个对象`, "success");
      }
      return recovered;
    } catch (e) {
      console.error("跨盘找回失败:", e);
      return 0;
    } finally {
      relocatingRef.current = false;
    }
  }, [loadAll]);

  useEffect(() => {
    relocateMissingRef.current = () => {
      void relocateMissing();
    };
  }, [relocateMissing]);

  useEffect(() => {
    if (selectedCabinetId === null) return;
    // 竞态防护：快速切换文件柜时，慢响应不得覆盖已切换的新选择
    let cancelled = false;
    db.getCabinetItems(selectedCabinetId)
      .then((data) => {
        if (!cancelled) setCabinetItems(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [selectedCabinetId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshItemById = useCallback(async (itemId: number) => {
    const item = await db.getItem(itemId);
    setAllItems((current) => upsertItem(current, item));
    setCabinetItems((current) =>
      current.some((cabinetItem) => cabinetItem.id === itemId)
        ? upsertItem(current, item)
        : current,
    );
    return item;
  }, []);

  const removeLocalItem = useCallback((itemId: number) => {
    setAllItems((current) => removeItemFromList(current, itemId));
    setCabinetItems((current) => removeItemFromList(current, itemId));
  }, []);

  const source = useMemo(() => {
    if (showFavorites) {
      return allItems.filter((item) => item.is_favorite);
    }
    if (selectedCabinetId !== null) {
      return cabinetItems;
    }
    return allItems;
  }, [allItems, cabinetItems, selectedCabinetId, showFavorites]);

  // 标签后代闭包：选中父标签时并入其所有后代标签的对象（图状层级筛选）。
  const descendantsMap = useMemo(() => buildDescendantsMap(tagRelations), [tagRelations]);

  const tagFiltered = useMemo(
    () =>
      filterItemsByTags(source, selectedTagIds, (id) => descendantsMap.get(id) ?? new Set([id])),
    [source, selectedTagIds, descendantsMap],
  );

  const searchIndex = useMemo(
    () => buildSearchIndex(tagFiltered, searchMode),
    [tagFiltered, searchMode],
  );

  const filtered = useMemo(
    () => searchWithIndex(searchIndex, deferredSearchQuery),
    [searchIndex, deferredSearchQuery],
  );

  const addItems = useCallback(async (paths: string[]) => {
    await withErrorToast("批量导入", async () => {
      const result = await db.addItems(paths);
      if (result.failed.length > 0) {
        const first = result.failed[0];
        showToast(`导入失败 ${result.failed.length} 项：${getPathDisplayName(first.path)}（${first.error}）`, "warning");
      }
      if (result.items.length === 0) return;

      const changedItems = await db.getItemsByIds(result.items.map((item) => item.id));
      setAllItems((current) => upsertItems(current, changedItems));
      setCabinetItems((current) => {
        const currentIds = new Set(current.map((item) => item.id));
        return upsertItems(
          current,
          changedItems.filter((item) => currentIds.has(item.id)),
        );
      });
    });
  }, []);

  const removeItem = useCallback(async (id: number) => {
    await withErrorToast("删除项目", async () => {
      await db.removeItem(id);
      removeLocalItem(id);
    });
  }, [removeLocalItem]);

  const removeItems = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;

    await withErrorToast("批量删除", async () => {
      await db.removeItems(ids);

      const idSet = new Set(ids);
      setAllItems((current) => current.filter((item) => !idSet.has(item.id)));
      setCabinetItems((current) => current.filter((item) => !idSet.has(item.id)));
    });
  }, []);

  const updateItemIcon = useCallback(async (itemId: number, iconPath: string | null) => {
    await withErrorToast("更新图标", async () => {
      await db.updateItemIcon(itemId, iconPath);
      await refreshItemById(itemId);
    });
  }, [refreshItemById]);

  const setItemTags = useCallback(async (itemId: number, tagIds: number[]) => {
    await withErrorToast("设置标签", async () => {
      await db.setItemTags(itemId, tagIds);
      await refreshItemById(itemId);
    });
  }, [refreshItemById]);

  const setManyItemTags = useCallback(async (changes: Array<{ itemId: number; tagIds: number[] }>) => {
    if (changes.length === 0) return;

    await withErrorToast("批量设置标签", async () => {
      await db.setManyItemTags(changes);

      const changedItems = await db.getItemsByIds(changes.map((change) => change.itemId));
      setAllItems((current) => upsertItems(current, changedItems));
      setCabinetItems((current) => {
        const currentIds = new Set(current.map((item) => item.id));
        return upsertItems(
          current,
          changedItems.filter((item) => currentIds.has(item.id)),
        );
      });
    });
  }, []);

  const launchItem = useCallback(async (id: number) => {
    try {
      await withErrorToast("启动项目", async () => {
        await db.launchItem(id);
        const item = allItemsRef.current.find((i) => i.id === id);
        if (item) notifyItemLaunched(id, item.name);
      });
    } catch (e) {
      // 启动失败（含"对象已丢失"）：后端可能已将 is_missing 置 1，
      // 刷新该项使失效徽标即时生效，再把错误抛给调用方。
      void refreshItemById(id).catch(() => {});
      throw e;
    }
  }, [refreshItemById]);

  const toggleFavorite = useCallback(async (id: number) => {
    await withErrorToast("切换收藏", async () => {
      await db.toggleFavorite(id);
      await refreshItemById(id);
    });
  }, [refreshItemById]);

  const addItemToCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await withErrorToast("添加到文件柜", async () => {
      await db.addItemToCabinet(cabinetId, itemId);
      if (selectedCabinetId === cabinetId) {
        const item = allItemsRef.current.find((current) => current.id === itemId) ?? await db.getItem(itemId);
        setCabinetItems((current) => upsertItem(current, item));
      }
    });
    notifyCabinetItemsChanged(cabinetId, [itemId]);
  }, [selectedCabinetId]);

  const addItemsToCabinet = useCallback(async (cabinetId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;

    await withErrorToast("批量添加到文件柜", async () => {
      await db.addItemsToCabinet(cabinetId, itemIds);

      if (selectedCabinetId === cabinetId) {
        const changedItems = await db.getItemsByIds(itemIds);
        setCabinetItems((current) => upsertItems(current, changedItems));
      }
    });
    notifyCabinetItemsChanged(cabinetId, itemIds);
  }, [selectedCabinetId]);

  const removeItemFromCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await withErrorToast("从文件柜移除", async () => {
      await db.removeItemFromCabinet(cabinetId, itemId);
      if (selectedCabinetId === cabinetId) {
        setCabinetItems((current) => removeItemFromList(current, itemId));
      }
    });
    notifyCabinetItemsChanged(cabinetId, [itemId]);
  }, [selectedCabinetId]);

  const removeItemsFromCabinet = useCallback(async (cabinetId: number, itemIds: number[]) => {
    if (itemIds.length === 0) return;

    await withErrorToast("批量从文件柜移除", async () => {
      await db.removeItemsFromCabinet(cabinetId, itemIds);

      if (selectedCabinetId === cabinetId) {
        const idSet = new Set(itemIds);
        setCabinetItems((current) => current.filter((item) => !idSet.has(item.id)));
      }
    });
    notifyCabinetItemsChanged(cabinetId, itemIds);
  }, [selectedCabinetId]);

  const findItemById = useCallback(
    (itemId: number) =>
      allItemsRef.current.find((item) => item.id === itemId) ??
      cabinetItemsRef.current.find((item) => item.id === itemId),
    [],
  );

  return {
    items: filtered,
    allItems,
    loading,
    refresh: loadAll,
    relocateMissing,
    addItems,
    removeItem,
    removeItems,
    updateItemIcon,
    setItemTags,
    setManyItemTags,
    launchItem,
    toggleFavorite,
    addItemToCabinet,
    addItemsToCabinet,
    removeItemFromCabinet,
    removeItemsFromCabinet,
    findItemById,
  };
}

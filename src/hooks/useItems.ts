import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from "react";
import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { buildSearchIndex, filterItemsByTags, searchWithIndex } from "../lib/search";
import { notifyItemLaunched, notifyItemsChanged } from "../lib/modApi";
import type { ItemWithTags } from "../types";

function showToast(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", { detail: { message, type } }),
  );
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
  const setItems = useAppStore((state) => state.setItems);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchMode = useAppStore((state) => state.searchMode);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [allItems, setAllItems] = useState<ItemWithTags[]>([]);
  const [cabinetItems, setCabinetItems] = useState<ItemWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const allItemsRef = useRef<ItemWithTags[]>([]);
  const cabinetItemsRef = useRef<ItemWithTags[]>([]);

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
      const data = await db.getItems();
      setAllItems(data);
    } catch (e) {
      console.error("Failed to load items:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCabinetId !== null) {
      db.getCabinetItems(selectedCabinetId).then(setCabinetItems).catch(console.error);
    }
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

  const tagFiltered = useMemo(
    () => filterItemsByTags(source, selectedTagIds),
    [source, selectedTagIds],
  );

  const searchIndex = useMemo(
    () => buildSearchIndex(tagFiltered, searchMode),
    [tagFiltered, searchMode],
  );

  const filtered = useMemo(
    () => searchWithIndex(searchIndex, deferredSearchQuery),
    [searchIndex, deferredSearchQuery],
  );

  useEffect(() => {
    setItems(filtered);
  }, [filtered, setItems]);

  const addItem = useCallback(async (path: string) => {
    const item = await db.addItem(path);
    await refreshItemById(item.id);
  }, [refreshItemById]);

  const addItems = useCallback(async (paths: string[]) => {
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
  }, []);

  const removeItem = useCallback(async (id: number) => {
    await db.removeItem(id);
    removeLocalItem(id);
  }, [removeLocalItem]);

  const updateItemIcon = useCallback(async (itemId: number, iconPath: string | null) => {
    await db.updateItemIcon(itemId, iconPath);
    await refreshItemById(itemId);
  }, [refreshItemById]);

  const setItemTags = useCallback(async (itemId: number, tagIds: number[]) => {
    await db.setItemTags(itemId, tagIds);
    await refreshItemById(itemId);
  }, [refreshItemById]);

  const launchItem = useCallback(async (id: number) => {
    await db.launchItem(id);
    const item = allItemsRef.current.find((i) => i.id === id);
    if (item) notifyItemLaunched(id, item.name);
  }, []);

  const toggleFavorite = useCallback(async (id: number) => {
    await db.toggleFavorite(id);
    await refreshItemById(id);
  }, [refreshItemById]);

  const addItemToCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await db.addItemToCabinet(cabinetId, itemId);
    if (selectedCabinetId === cabinetId) {
      const item = allItemsRef.current.find((current) => current.id === itemId) ?? await db.getItem(itemId);
      setCabinetItems((current) => upsertItem(current, item));
    }
  }, [selectedCabinetId]);

  const removeItemFromCabinet = useCallback(async (cabinetId: number, itemId: number) => {
    await db.removeItemFromCabinet(cabinetId, itemId);
    if (selectedCabinetId === cabinetId) {
      setCabinetItems((current) => removeItemFromList(current, itemId));
    }
  }, [selectedCabinetId]);

  const findItemById = useCallback(
    (itemId: number) =>
      allItemsRef.current.find((item) => item.id === itemId) ??
      cabinetItemsRef.current.find((item) => item.id === itemId),
    [],
  );

  return {
    items: filtered,
    loading,
    refresh: loadAll,
    addItem,
    addItems,
    removeItem,
    updateItemIcon,
    setItemTags,
    launchItem,
    toggleFavorite,
    addItemToCabinet,
    removeItemFromCabinet,
    findItemById,
  };
}

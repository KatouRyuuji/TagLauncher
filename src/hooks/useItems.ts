import { useState, useEffect, useCallback, useMemo } from "react";
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

export function useItems() {
  const { setItems, searchQuery, searchMode, selectedTagIds, selectedCabinetId, showFavorites } = useAppStore();

  const [allItems, setAllItems] = useState<ItemWithTags[]>([]);
  const [cabinetItems, setCabinetItems] = useState<ItemWithTags[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getItems();
      setAllItems(data);
      notifyItemsChanged(data);
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

  const refreshSelectedCabinetItems = useCallback(async () => {
    if (selectedCabinetId === null) {
      return;
    }

    const updated = await db.getCabinetItems(selectedCabinetId);
    setCabinetItems(updated);
  }, [selectedCabinetId]);

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
    () => searchWithIndex(searchIndex, searchQuery),
    [searchIndex, searchQuery],
  );

  useEffect(() => {
    setItems(filtered);
  }, [filtered, setItems]);

  const addItem = async (path: string) => {
    await db.addItem(path);
    await loadAll();
  };

  const addItems = async (paths: string[]) => {
    const result = await db.addItems(paths);
    if (result.failed.length > 0) {
      const first = result.failed[0];
      showToast(`导入失败 ${result.failed.length} 项：${getPathDisplayName(first.path)}（${first.error}）`, "warning");
    }
    await loadAll();
  };

  const removeItem = async (id: number) => {
    await db.removeItem(id);
    await loadAll();
    await refreshSelectedCabinetItems();
  };

  const updateItemIcon = async (itemId: number, iconPath: string | null) => {
    await db.updateItemIcon(itemId, iconPath);
    await loadAll();
    await refreshSelectedCabinetItems();
  };

  const setItemTags = async (itemId: number, tagIds: number[]) => {
    await db.setItemTags(itemId, tagIds);
    await loadAll();
    await refreshSelectedCabinetItems();
  };

  const launchItem = async (id: number) => {
    await db.launchItem(id);
    const item = allItems.find((i) => i.id === id);
    if (item) notifyItemLaunched(id, item.name);
  };

  const toggleFavorite = async (id: number) => {
    await db.toggleFavorite(id);
    await loadAll();
    await refreshSelectedCabinetItems();
  };

  const addItemToCabinet = async (cabinetId: number, itemId: number) => {
    await db.addItemToCabinet(cabinetId, itemId);
    if (selectedCabinetId === cabinetId) {
      await refreshSelectedCabinetItems();
    }
  };

  const removeItemFromCabinet = async (cabinetId: number, itemId: number) => {
    await db.removeItemFromCabinet(cabinetId, itemId);
    if (selectedCabinetId === cabinetId) {
      await refreshSelectedCabinetItems();
    }
  };

  const findItemById = useCallback(
    (itemId: number) => allItems.find((item) => item.id === itemId) ?? cabinetItems.find((item) => item.id === itemId),
    [allItems, cabinetItems],
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

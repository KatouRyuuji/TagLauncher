import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { Sidebar } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { TagFilterBar } from "./components/TagFilterBar";
import { ItemGrid } from "./components/ItemGrid";
import { ItemListView } from "./components/ItemListView";
import { WelcomeModal } from "./components/WelcomeModal";
import { ThemeProvider } from "./components/ThemeProvider";
import { SettingsPanel } from "./components/SettingsPanel";
import { MigrationDialog } from "./components/MigrationDialog";
import { InternalDragGhost, ItemDropActions } from "./components/InternalDragOverlays";
import { BatchSelectionToolbar } from "./components/BatchSelectionToolbar";
import { RemoveFromAppConfirmDialog } from "./components/RemoveFromAppConfirmDialog";
import { useItems } from "./hooks/useItems";
import { useTags } from "./hooks/useTags";
import { useCabinets } from "./hooks/useCabinets";
import { useAppStore } from "./stores/appStore";
import { useInternalDragStore } from "./stores/internalDragStore";
import { loadSynonyms } from "./lib/synonyms";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { initModApi, notifySelectionChanged } from "./lib/modApi";
import { initModRuntime } from "./lib/modRuntime";
import { ToastContainer } from "./components/ToastContainer";
import { FloatingPanels } from "./components/FloatingPanels";
import { getThemeTagPresetColors } from "./lib/tagColors";
import {
  PANEL_CREATE, PANEL_DESTROY, PANEL_SHOW, PANEL_HIDE, PANEL_TITLE,
} from "./lib/panelRegistry";
import type { PanelDescriptor } from "./types/panel";
import * as db from "./lib/db";
import { hasPotentialExternalFileDrag, extractDroppedPaths } from "./lib/dropPaths";

const WELCOME_HIDE_KEY = "taglauncher.hide_welcome_modal";
const SKIP_REMOVE_ITEM_CONFIRM_KEY = "taglauncher.skip_remove_item_confirm";

function App() {
  const {
    items,
    loading,
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
    refresh,
  } = useItems();
  const { tags, addTag, updateTag, removeTag } = useTags();
  const { addCabinet, updateCabinet, removeCabinet } = useCabinets();
  const viewMode = useAppStore((state) => state.viewMode);
  const cabinets = useAppStore((state) => state.cabinets);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const hasActiveInternalDrag = useInternalDragStore((state) => state.drag !== null);
  const isDraggingItem = useInternalDragStore((state) => state.drag?.kind === "item");
  const hasActiveInternalDragRef = useRef(false);

  const [dragOver, setDragOver] = useState(false);
  const [sidebarPanels, setSidebarPanels] = useState<PanelDescriptor[]>([]);
  const [pendingRemoveItemId, setPendingRemoveItemId] = useState<number | null>(null);
  const [pendingBatchRemoveItemIds, setPendingBatchRemoveItemIds] = useState<number[] | null>(null);
  const [skipRemoveItemConfirm, setSkipRemoveItemConfirm] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);

  // 向 Mod 同步当前复选集合，使 Mod 可读取选择上下文并监听变化（onSelectionChanged）
  useEffect(() => {
    notifySelectionChanged(selectedItemIds);
  }, [selectedItemIds]);
  const externalDragDepthRef = useRef(0);
  const recentDropRef = useRef<{ key: string; ts: number }>({ key: "", ts: 0 });
  const recentLaunchRef = useRef<Map<number, number>>(new Map());
  const addDroppedPathsRef = useRef<(paths: string[]) => Promise<void>>(async () => {});
  const [showSettings, setShowSettings] = useState(false);
  const { migration, dismissMigration } = useVersionCheck();
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WELCOME_HIDE_KEY) !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    hasActiveInternalDragRef.current = hasActiveInternalDrag;
    if (hasActiveInternalDrag) {
      externalDragDepthRef.current = 0;
      setDragOver(false);
    }
  }, [hasActiveInternalDrag]);

  useEffect(() => {
    void loadSynonyms();
    initModApi();
    // 初始化 mod 运行时：注入所有已启用 mod 的 CSS / JS / Theme
    void db.getMods().then(initModRuntime);
  }, []);

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => {
      // 输入框/文本域/可编辑区域放行原生右键菜单（复制粘贴等），其余仍拦截。
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable
        ) {
          return;
        }
      }
      event.preventDefault();
    };

    window.addEventListener("contextmenu", preventNativeContextMenu, true);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu, true);
  }, []);

  // ── Sidebar Panel 事件管理 ─────────────────────────────────────────────
  useEffect(() => {
    const onCreate = (e: Event) => {
      const desc = (e as CustomEvent<PanelDescriptor>).detail;
      if (desc.position !== "sidebar") return;
      setSidebarPanels((prev) =>
        prev.some((p) => p.id === desc.id) ? prev : [...prev, desc],
      );
    };
    const onDestroy = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSidebarPanels((prev) => prev.filter((p) => p.id !== id));
    };
    const onShow = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSidebarPanels((prev) => prev.map((p) => p.id === id ? { ...p, visible: true } : p));
    };
    const onHide = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSidebarPanels((prev) => prev.map((p) => p.id === id ? { ...p, visible: false } : p));
    };
    const onTitle = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setSidebarPanels((prev) => prev.map((p) => p.id === id ? { ...p, title } : p));
    };
    window.addEventListener(PANEL_CREATE, onCreate);
    window.addEventListener(PANEL_DESTROY, onDestroy);
    window.addEventListener(PANEL_SHOW, onShow);
    window.addEventListener(PANEL_HIDE, onHide);
    window.addEventListener(PANEL_TITLE, onTitle);
    return () => {
      window.removeEventListener(PANEL_CREATE, onCreate);
      window.removeEventListener(PANEL_DESTROY, onDestroy);
      window.removeEventListener(PANEL_SHOW, onShow);
      window.removeEventListener(PANEL_HIDE, onHide);
      window.removeEventListener(PANEL_TITLE, onTitle);
    };
  }, []);

  const addDroppedPaths = useCallback(
    async (paths: string[]) => {
      const normalized = Array.from(
        new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0)),
      );
      if (normalized.length === 0) return;

      const key = normalized.join("\n");
      const now = Date.now();
      if (recentDropRef.current.key === key && now - recentDropRef.current.ts < 800) {
        return;
      }
      recentDropRef.current = { key, ts: now };

      await addItems(normalized);
    },
    [addItems],
  );

  useEffect(() => {
    addDroppedPathsRef.current = addDroppedPaths;
  }, [addDroppedPaths]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const handleNativeDragDropEvent = (event: { payload: DragDropEvent }) => {
      const eventType = event.payload.type;

      if (hasActiveInternalDragRef.current) {
        if (eventType === "leave" || eventType === "drop") {
          setDragOver(false);
        }
        return;
      }

      if (eventType === "enter" || eventType === "over") {
        setDragOver(true);
        return;
      }

      if (eventType === "leave") {
        setDragOver(false);
        return;
      }

      if (eventType === "drop") {
        externalDragDepthRef.current = 0;
        setDragOver(false);
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) {
          return;
        }

        void addDroppedPathsRef.current(paths);
      }
    };

    const registerNativeListener = async (
      register: () => Promise<() => void>,
      label: string,
    ) => {
      try {
        const unlisten = await register();
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      } catch (error) {
        console.error(`Failed to register ${label} drag-drop listener:`, error);
      }
    };

    void registerNativeListener(
      () => getCurrentWindow().onDragDropEvent(handleNativeDragDropEvent),
      "window",
    );
    void registerNativeListener(
      () => getCurrentWebview().onDragDropEvent(handleNativeDragDropEvent),
      "webview",
    );

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  const handleMainDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    externalDragDepthRef.current += 1;
    setDragOver(true);
  }, [hasActiveInternalDrag]);

  const handleMainDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, [hasActiveInternalDrag]);

  const handleMainDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1);
    if (externalDragDepthRef.current === 0) {
      setDragOver(false);
    }
  }, [hasActiveInternalDrag]);

  const handleMainDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    externalDragDepthRef.current = 0;
    setDragOver(false);
    const paths = extractDroppedPaths(e.dataTransfer);
    if (paths.length === 0) return;
    void addDroppedPaths(paths);
  }, [addDroppedPaths, hasActiveInternalDrag]);

  const handleAddTagToItem = useCallback(
    async (itemId: number, tagId: number) => {
      const item = findItemById(itemId);
      if (!item) return;

      const existing = item.tags.map((t) => t.id);
      if (existing.includes(tagId)) return;

      await setItemTags(itemId, [...existing, tagId]);
    },
    [findItemById, setItemTags],
  );

  const handleRemoveTagFromItem = useCallback(
    async (itemId: number, tagId: number) => {
      const item = findItemById(itemId);
      if (!item) return;

      await setItemTags(
        itemId,
        item.tags.filter((t) => t.id !== tagId).map((t) => t.id),
      );
    },
    [findItemById, setItemTags],
  );

  // 用 ref 持有最新 tags，使 handleAddNewTagToItem 引用稳定（不随 tags 变化重建），
  // 避免击穿下游 viewProps memo 导致框选等场景下整列表卡片重渲染。
  const tagsRef = useRef(tags);
  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  const handleAddNewTagToItem = useCallback(
    async (itemId: number, tagName: string, baseTagIds?: number[]): Promise<number[]> => {
      const normalizedName = tagName.trim();
      if (!normalizedName) {
        return baseTagIds ?? [];
      }

      const existingTag = tagsRef.current.find((t) => t.name === normalizedName);
      let tagId: number;

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const colors = getThemeTagPresetColors();
        const color = colors[Math.floor(Math.random() * colors.length)];
        const newTag = await addTag(normalizedName, color);
        tagId = newTag.id;
      }

      const item = findItemById(itemId);
      const currentTagIds = item ? item.tags.map((t) => t.id) : [];
      const sourceTagIds = baseTagIds ?? currentTagIds;
      const nextTagIds = Array.from(new Set([...sourceTagIds, tagId]));

      await setItemTags(itemId, nextTagIds);
      return nextTagIds;
    },
    [addTag, findItemById, setItemTags],
  );

  const handleClearCurrentFilter = useCallback(
    async (itemId: number) => {
      const item = findItemById(itemId);
      if (!item) return;

      if (selectedTagIds.length > 0) {
        const activeTagIds = new Set(selectedTagIds);
        const nextTagIds = item.tags
          .filter((tag) => !activeTagIds.has(tag.id))
          .map((tag) => tag.id);
        if (nextTagIds.length !== item.tags.length) {
          await setItemTags(itemId, nextTagIds);
        }
        return;
      }

      if (selectedCabinetId !== null) {
        await removeItemFromCabinet(selectedCabinetId, itemId);
      }
    },
    [findItemById, removeItemFromCabinet, selectedCabinetId, selectedTagIds, setItemTags],
  );

  const handleRequestRemoveFromApp = useCallback(
    async (itemId: number) => {
      let skipConfirm = false;
      try {
        skipConfirm = localStorage.getItem(SKIP_REMOVE_ITEM_CONFIRM_KEY) === "1";
      } catch {
        skipConfirm = false;
      }

      if (skipConfirm) {
        await removeItem(itemId);
        setSelectedItemIds((current) => current.filter((id) => id !== itemId));
        return;
      }

      setSkipRemoveItemConfirm(false);
      setPendingRemoveItemId(itemId);
    },
    [removeItem],
  );

  const handleRequestBatchRemoveFromApp = useCallback(
    async () => {
      if (selectedItemIds.length === 0) return;

      let skipConfirm = false;
      try {
        skipConfirm = localStorage.getItem(SKIP_REMOVE_ITEM_CONFIRM_KEY) === "1";
      } catch {
        skipConfirm = false;
      }

      if (skipConfirm) {
        await removeItems(selectedItemIds);
        setSelectedItemIds([]);
        return;
      }

      setSkipRemoveItemConfirm(false);
      setPendingBatchRemoveItemIds(selectedItemIds);
    },
    [removeItems, selectedItemIds],
  );

  const handleConfirmRemoveFromApp = useCallback(async () => {
    const itemIds = pendingBatchRemoveItemIds ?? (pendingRemoveItemId === null ? [] : [pendingRemoveItemId]);
    if (itemIds.length === 0) return;

    try {
      if (skipRemoveItemConfirm) {
        localStorage.setItem(SKIP_REMOVE_ITEM_CONFIRM_KEY, "1");
      }
    } catch {
      // ignore storage failures
    }

    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    setSkipRemoveItemConfirm(false);
    await removeItems(itemIds);
    setSelectedItemIds((current) => current.filter((itemId) => !itemIds.includes(itemId)));
  }, [pendingBatchRemoveItemIds, pendingRemoveItemId, removeItems, skipRemoveItemConfirm]);

  const handleCancelRemoveFromApp = useCallback(() => {
    setPendingRemoveItemId(null);
    setPendingBatchRemoveItemIds(null);
    setSkipRemoveItemConfirm(false);
  }, []);

  // 启动去抖：同一对象 300ms 内只真正启动一次，避免双击重复拉起进程。
  const handleLaunchItem = useCallback(
    async (itemId: number) => {
      const now = Date.now();
      const last = recentLaunchRef.current.get(itemId) ?? 0;
      if (now - last < 300) return;
      recentLaunchRef.current.set(itemId, now);
      await launchItem(itemId);
    },
    [launchItem],
  );

  const handleSelectItems = useCallback((itemIds: number[]) => {
    setSelectedItemIds(itemIds);
  }, []);

  const selectedItems = useMemo(() => {
    if (selectedItemIds.length === 0) return [];

    const selected = new Set(selectedItemIds);
    return items.filter((item) => selected.has(item.id));
  }, [items, selectedItemIds]);

  // 选中对象实际拥有标签的并集，供"移除标签"菜单使用（避免列出谁都没有的标签）。
  const selectedItemsTags = useMemo(() => {
    const seen = new Set<number>();
    const result: Array<{ id: number; name: string; color: string }> = [];
    for (const item of selectedItems) {
      for (const tag of item.tags) {
        if (seen.has(tag.id)) continue;
        seen.add(tag.id);
        result.push({ id: tag.id, name: tag.name, color: tag.color });
      }
    }
    return result;
  }, [selectedItems]);

  const handleBatchAddTag = useCallback(async (tagId: number) => {
    await setManyItemTags(
      selectedItems.flatMap((item) => {
        const currentTagIds = item.tags.map((tag) => tag.id);
        return currentTagIds.includes(tagId)
          ? []
          : [{ itemId: item.id, tagIds: [...currentTagIds, tagId] }];
      }),
    );
  }, [selectedItems, setManyItemTags]);

  const handleBatchRemoveTag = useCallback(async (tagId: number) => {
    await setManyItemTags(
      selectedItems.flatMap((item) => {
        const currentTagIds = item.tags.map((tag) => tag.id);
        return currentTagIds.includes(tagId)
          ? [{ itemId: item.id, tagIds: currentTagIds.filter((currentTagId) => currentTagId !== tagId) }]
          : [];
      }),
    );
  }, [selectedItems, setManyItemTags]);

  const handleBatchAddToCabinet = useCallback(async (cabinetId: number) => {
    await addItemsToCabinet(cabinetId, selectedItemIds);
  }, [addItemsToCabinet, selectedItemIds]);

  const handleBatchRemoveFromCabinet = useCallback(async () => {
    if (selectedCabinetId === null) return;

    await removeItemsFromCabinet(selectedCabinetId, selectedItemIds);
    setSelectedItemIds([]);
  }, [removeItemsFromCabinet, selectedCabinetId, selectedItemIds]);

  const handleCloseWelcome = useCallback((hideNextTime: boolean) => {
    setShowWelcomeModal(false);
    try {
      if (hideNextTime) {
        localStorage.setItem(WELCOME_HIDE_KEY, "1");
      } else {
        localStorage.removeItem(WELCOME_HIDE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  const handleOpenAbout = useCallback(() => {
    setShowWelcomeModal(true);
  }, []);

  const viewProps = {
    items,
    tags,
    cabinets,
    loading,
    currentCabinetId: selectedCabinetId,
    onLaunch: handleLaunchItem,
    onRemove: removeItem,
    onSetTags: setItemTags,
    onSetManyTags: setManyItemTags,
    onAddTagToItem: handleAddTagToItem,
    onRemoveTagFromItem: handleRemoveTagFromItem,
    onAddNewTagToItem: handleAddNewTagToItem,
    onToggleFavorite: toggleFavorite,
    onAddItemToCabinet: addItemToCabinet,
    onAddItemsToCabinet: addItemsToCabinet,
    onRemoveItemFromCabinet: removeItemFromCabinet,
    onRemoveItemsFromCabinet: removeItemsFromCabinet,
    onClearCurrentFilter: handleClearCurrentFilter,
    onRequestRemoveFromApp: handleRequestRemoveFromApp,
    onUpdateThumbnail: updateItemIcon,
    selectedItemIds,
    onSelectItems: handleSelectItems,
  };

  return (
    <ThemeProvider>
    <div data-region="root" className="select-none" style={{ fontFamily: "var(--font-family)" }}>
      <div
        data-region="bg-decoration"
        className="fixed inset-0 pointer-events-none"
        style={{ background: "var(--bg-gradient)", zIndex: "var(--z-bg-decoration)" as unknown as number }}
      />
      <Sidebar
        tags={tags}
        cabinets={cabinets}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onRemoveTag={removeTag}
        onAddCabinet={addCabinet}
        onUpdateCabinet={updateCabinet}
        onRemoveCabinet={removeCabinet}
        onAddTagToItem={handleAddTagToItem}
        modPanels={sidebarPanels}
      />
      <main
        data-region="main"
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-surface)]"
        onDragEnter={handleMainDragEnter}
        onDragOver={handleMainDragOver}
        onDragLeave={handleMainDragLeave}
        onDrop={handleMainDrop}
      >
        <SearchBar onAddItems={addItems} onRefresh={refresh} onOpenAbout={handleOpenAbout} onOpenSettings={() => setShowSettings(true)} />
        <TagFilterBar />
        {viewMode === "grid" ? <ItemGrid {...viewProps} /> : <ItemListView {...viewProps} />}
        <BatchSelectionToolbar
          selectedCount={isDraggingItem ? 0 : selectedItemIds.length}
          tags={tags}
          removableTags={selectedItemsTags}
          cabinets={cabinets}
          canRemoveFromCabinet={selectedCabinetId !== null}
          onAddTag={handleBatchAddTag}
          onRemoveTag={handleBatchRemoveTag}
          onAddToCabinet={handleBatchAddToCabinet}
          onRemoveFromCabinet={handleBatchRemoveFromCabinet}
          onRemoveFromApp={handleRequestBatchRemoveFromApp}
          onClearSelection={() => setSelectedItemIds([])}
        />
        <ItemDropActions
          visible={isDraggingItem}
          mode={selectedTagIds.length > 0 ? "tags" : "cabinet"}
          enabled={selectedTagIds.length > 0 || selectedCabinetId !== null}
        />
        {dragOver && (
          <div className="absolute inset-4 z-50 flex items-center justify-center rounded-[calc(var(--radius-xl)+6px)] border-2 border-dashed border-[color-mix(in_srgb,var(--accent-primary)_58%,transparent)] bg-[var(--accent-primary-bg-light)] pointer-events-none">
            <div className="surface-card px-8 py-7 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 12 4-4m-4 4-4-4M4 18.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5" />
                </svg>
              </div>
              <p className="text-[var(--accent-primary)] text-base font-semibold">释放以添加文件</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">支持文件、图片和文件夹批量导入</p>
            </div>
          </div>
        )}
        <InternalDragGhost />
      </main>
      <WelcomeModal open={showWelcomeModal} onClose={handleCloseWelcome} />
      <RemoveFromAppConfirmDialog
        open={pendingRemoveItemId !== null || pendingBatchRemoveItemIds !== null}
        itemCount={pendingBatchRemoveItemIds?.length ?? 1}
        skipNextTime={skipRemoveItemConfirm}
        onSkipNextTimeChange={setSkipRemoveItemConfirm}
        onConfirm={handleConfirmRemoveFromApp}
        onCancel={handleCancelRemoveFromApp}
      />
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <FloatingPanels />
      <ToastContainer />
      <MigrationDialog
        open={migration.show}
        appliedMigrations={migration.appliedMigrations}
        fromVersion={migration.fromVersion}
        toVersion={migration.toVersion}
        onClose={dismissMigration}
      />
    </div>
    </ThemeProvider>
  );
}

export default App;

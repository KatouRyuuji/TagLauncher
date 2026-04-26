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
import { useItems } from "./hooks/useItems";
import { useTags } from "./hooks/useTags";
import { useCabinets } from "./hooks/useCabinets";
import { useAppStore } from "./stores/appStore";
import { useInternalDragStore } from "./stores/internalDragStore";
import { loadSynonyms } from "./lib/synonyms";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { initModApi } from "./lib/modApi";
import { initModRuntime } from "./lib/modRuntime";
import { ToastContainer } from "./components/ToastContainer";
import { FloatingPanels } from "./components/FloatingPanels";
import { getThemeTagPresetColors } from "./lib/tagColors";
import {
  PANEL_CREATE, PANEL_DESTROY, PANEL_SHOW, PANEL_HIDE, PANEL_TITLE,
} from "./lib/panelRegistry";
import type { PanelDescriptor } from "./types/panel";
import * as db from "./lib/db";

const WELCOME_HIDE_KEY = "taglauncher.hide_welcome_modal";
const SKIP_REMOVE_ITEM_CONFIRM_KEY = "taglauncher.skip_remove_item_confirm";

function hasPotentialExternalFileDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? []);

  if (types.includes("Files") || types.includes("text/uri-list")) {
    return true;
  }

  if (dataTransfer.files.length > 0 || dataTransfer.items.length > 0) {
    return true;
  }

  // WebView2 在外部拖拽进入阶段不一定稳定暴露标准类型。
  // 没有类型时先允许主视图接管，真正落下时再解析路径。
  return types.length === 0;
}

function fileUriToPath(uri: string): string | null {
  const value = uri.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") return null;

    let pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }

    if (parsed.host) {
      return `\\\\${parsed.host}${pathname.replace(/\//g, "\\")}`;
    }

    return pathname.replace(/\//g, "\\");
  } catch {
    return null;
  }
}

function extractDroppedPaths(dataTransfer: DataTransfer): string[] {
  const result = new Set<string>();

  for (const file of Array.from(dataTransfer.files ?? [])) {
    const fileWithPath = file as File & { path?: string };
    if (typeof fileWithPath.path === "string" && fileWithPath.path.trim().length > 0) {
      result.add(fileWithPath.path.trim());
    }
  }

  const uriList = dataTransfer.getData("text/uri-list");
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const path = fileUriToPath(trimmed);
    if (path) {
      result.add(path);
    }
  }

  const plain = dataTransfer.getData("text/plain");
  for (const line of plain.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("file://")) continue;
    const path = fileUriToPath(trimmed);
    if (path) {
      result.add(path);
    }
  }

  return Array.from(result);
}

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
  const externalDragDepthRef = useRef(0);
  const recentDropRef = useRef<{ key: string; ts: number }>({ key: "", ts: 0 });
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

  const handleAddNewTagToItem = useCallback(
    async (itemId: number, tagName: string, baseTagIds?: number[]): Promise<number[]> => {
      const normalizedName = tagName.trim();
      if (!normalizedName) {
        return baseTagIds ?? [];
      }

      const existingTag = tags.find((t) => t.name === normalizedName);
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
    [tags, addTag, findItemById, setItemTags],
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

  const handleSelectItems = useCallback((itemIds: number[]) => {
    setSelectedItemIds(itemIds);
  }, []);

  const selectedItems = useMemo(() => {
    if (selectedItemIds.length === 0) return [];

    const selected = new Set(selectedItemIds);
    return items.filter((item) => selected.has(item.id));
  }, [items, selectedItemIds]);

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
    onLaunch: launchItem,
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

function InternalDragGhost() {
  const activeInternalDrag = useInternalDragStore((state) => state.drag);
  if (!activeInternalDrag) return null;

  return (
    <div
      className="fixed pointer-events-none"
      style={{
        zIndex: "var(--z-drag-ghost)" as unknown as number,
        left: `calc(${activeInternalDrag.x}px + var(--drag-ghost-offset-x))`,
        top:  `calc(${activeInternalDrag.y}px + var(--drag-ghost-offset-y))`,
      }}
    >
      <div className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow-2xl" style={{ backgroundColor: "var(--bg-elevated)", borderWidth: "var(--border-width)" as unknown as number, borderStyle: "var(--border-style)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
        {"color" in activeInternalDrag && (
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: activeInternalDrag.color }}
          />
        )}
        <span className="max-w-[220px] truncate">
          {activeInternalDrag.kind === "item" ? `添加对象: ${activeInternalDrag.label}` : activeInternalDrag.label}
        </span>
      </div>
    </div>
  );
}

function ItemDropActions({
  visible,
  mode,
  enabled,
}: {
  visible: boolean;
  mode: "tags" | "cabinet";
  enabled: boolean;
}) {
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  if (!visible) return null;

  const leftActive = hoverTarget?.kind === "item-clear-current-filter";
  const rightActive = hoverTarget?.kind === "item-remove-from-app";
  const leftTitle = enabled
    ? mode === "tags"
      ? "清空当前标签"
      : "移出当前文件夹"
    : "选择标签或文件夹后可用";
  const leftDescription = enabled
    ? mode === "tags"
      ? "从对象上移除当前激活标签"
      : "对象保留在应用中"
    : "当前没有可清理的分类筛选";

  return (
    <div className="pointer-events-none absolute inset-x-5 bottom-8 z-40 grid grid-cols-2 gap-6">
      <div
        data-drop-item-clear-current-filter={enabled ? 1 : 0}
        className={`pointer-events-auto flex min-h-[120px] items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 text-center shadow-[var(--shadow-sm)] ${
          enabled
            ? leftActive
              ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
              : "border-[color-mix(in_srgb,var(--accent-primary)_34%,transparent)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] text-[var(--text-secondary)]"
            : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_68%,transparent)] text-[var(--text-faint)]"
        }`}
      >
        <div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-white/70">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M9 8l-4 4 4 4" />
            </svg>
          </div>
          <p className="text-sm font-semibold">{leftTitle}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{leftDescription}</p>
        </div>
      </div>

      <div
        data-drop-item-remove-from-app={1}
        className={`pointer-events-auto flex min-h-[120px] items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 text-center shadow-[var(--shadow-sm)] ${
          rightActive
            ? "border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
            : "border-[color-mix(in_srgb,var(--color-danger)_34%,transparent)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] text-[var(--text-secondary)]"
        }`}
      >
        <div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-white/70">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12m-8 4v6m4-6v6M9 7l1-2h4l1 2m-8 0 1 13h8l1-13" />
            </svg>
          </div>
          <p className="text-sm font-semibold">从应用移除</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">不删除本地文件</p>
        </div>
      </div>
    </div>
  );
}

function BatchSelectionToolbar({
  selectedCount,
  tags,
  cabinets,
  canRemoveFromCabinet,
  onAddTag,
  onRemoveTag,
  onAddToCabinet,
  onRemoveFromCabinet,
  onRemoveFromApp,
  onClearSelection,
}: {
  selectedCount: number;
  tags: Array<{ id: number; name: string; color: string }>;
  cabinets: Array<{ id: number; name: string; color: string }>;
  canRemoveFromCabinet: boolean;
  onAddTag: (tagId: number) => Promise<void>;
  onRemoveTag: (tagId: number) => Promise<void>;
  onAddToCabinet: (cabinetId: number) => Promise<void>;
  onRemoveFromCabinet: () => Promise<void>;
  onRemoveFromApp: () => Promise<void>;
  onClearSelection: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<"add-tag" | "remove-tag" | "cabinet" | null>(null);

  useEffect(() => {
    if (!openMenu) return;

    const close = () => setOpenMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);

  if (selectedCount === 0) return null;

  const runAction = (action: () => Promise<void>) => {
    setOpenMenu(null);
    void action();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-5 bottom-8 z-50 flex justify-center"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="surface-card pointer-events-auto flex max-w-[calc(100vw-var(--sidebar-width)-40px)] items-center gap-2 px-3 py-2 shadow-[var(--shadow-dropdown)]">
        <div className="flex items-center gap-2 border-r border-[var(--border-subtle)] pr-3 text-sm font-semibold text-[var(--text-primary)]">
          <span className="flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent-primary)] px-2 text-xs text-[var(--text-invert)]">
            {selectedCount}
          </span>
          已选中
        </div>

        <ToolbarMenuButton
          label="加入标签"
          open={openMenu === "add-tag"}
          onClick={() => setOpenMenu(openMenu === "add-tag" ? null : "add-tag")}
        >
          {tags.length === 0 ? (
            <MenuEmptyText>暂无标签</MenuEmptyText>
          ) : (
            tags.map((tag) => (
              <MenuOption key={tag.id} color={tag.color} label={tag.name} onClick={() => runAction(() => onAddTag(tag.id))} />
            ))
          )}
        </ToolbarMenuButton>

        <ToolbarMenuButton
          label="移除标签"
          open={openMenu === "remove-tag"}
          onClick={() => setOpenMenu(openMenu === "remove-tag" ? null : "remove-tag")}
        >
          {tags.length === 0 ? (
            <MenuEmptyText>暂无标签</MenuEmptyText>
          ) : (
            tags.map((tag) => (
              <MenuOption key={tag.id} color={tag.color} label={tag.name} onClick={() => runAction(() => onRemoveTag(tag.id))} />
            ))
          )}
        </ToolbarMenuButton>

        <ToolbarMenuButton
          label="文件夹"
          open={openMenu === "cabinet"}
          onClick={() => setOpenMenu(openMenu === "cabinet" ? null : "cabinet")}
        >
          {cabinets.length === 0 ? (
            <MenuEmptyText>暂无文件夹</MenuEmptyText>
          ) : (
            cabinets.map((cabinet) => (
              <MenuOption key={cabinet.id} color={cabinet.color} label={`加入 ${cabinet.name}`} onClick={() => runAction(() => onAddToCabinet(cabinet.id))} />
            ))
          )}
          <button
            type="button"
            disabled={!canRemoveFromCabinet}
            onClick={() => runAction(onRemoveFromCabinet)}
            className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
          >
            从当前文件夹移出
          </button>
        </ToolbarMenuButton>

        <button
          type="button"
          onClick={() => void onRemoveFromApp()}
          className="action-button text-[var(--color-danger)] hover:text-[var(--color-danger-hover)]"
        >
          批量删除
        </button>
        <button type="button" onClick={onClearSelection} className="action-button">
          取消选择
        </button>
      </div>
    </div>
  );
}

function ToolbarMenuButton({
  label,
  open,
  onClick,
  children,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button type="button" onClick={onClick} className={`action-button ${open ? "border-[var(--accent-primary)] text-[var(--accent-primary)]" : ""}`}>
        {label}
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 max-h-[260px] min-w-[190px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-dropdown)]">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuOption({
  color,
  label,
  onClick,
}: {
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function MenuEmptyText({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-sm text-[var(--text-faint)]">{children}</div>;
}

function RemoveFromAppConfirmDialog({
  open,
  itemCount,
  skipNextTime,
  onSkipNextTimeChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  itemCount: number;
  skipNextTime: boolean;
  onSkipNextTimeChange: (value: boolean) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-overlay)" as unknown as number }}
        onClick={onCancel}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: "var(--z-settings-panel)" as unknown as number }}
      >
        <div className="modal-surface pointer-events-auto w-[420px] max-w-[92vw] p-6" role="dialog" aria-modal="true" aria-label="移除对象确认">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12m-8 4v6m4-6v6M9 7l1-2h4l1 2m-8 0 1 13h8l1-13" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-label">Confirm</div>
              <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
                这会使得{itemCount > 1 ? `${itemCount} 个对象` : "对象"}在应用内被移除（不删除本地文件），是否确认？
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSkipNextTimeChange(!skipNextTime)}
            aria-pressed={skipNextTime}
            className="mt-5 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-input)]">
              {skipNextTime && (
                <svg className="h-3 w-3 text-[var(--accent-primary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            下次不再确认
          </button>

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="action-button">
              no
            </button>
            <button type="button" onClick={() => void onConfirm()} className="action-button action-button-primary">
              yes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;

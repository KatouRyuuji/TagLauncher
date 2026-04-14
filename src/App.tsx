import { useState, useCallback, useEffect, useRef } from "react";
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
import * as db from "./lib/db";

const WELCOME_HIDE_KEY = "taglauncher.hide_welcome_modal";

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
    refresh,
  } = useItems();
  const { tags, addTag, updateTag, removeTag } = useTags();
  const { addCabinet, updateCabinet, removeCabinet } = useCabinets();
  const { viewMode, cabinets, selectedCabinetId } = useAppStore();
  const activeInternalDrag = useInternalDragStore((state) => state.drag);
  const hasActiveInternalDrag = activeInternalDrag !== null;

  const [dragOver, setDragOver] = useState(false);
  const externalDragDepthRef = useRef(0);
  const recentDropRef = useRef<{ key: string; ts: number }>({ key: "", ts: 0 });
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
    void loadSynonyms();
    initModApi();
    // 初始化 mod 运行时：注入所有已启用 mod 的 CSS / JS / Theme
    void db.getMods().then(initModRuntime);
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
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const handleNativeDragDropEvent = (event: { payload: DragDropEvent }) => {
      const eventType = event.payload.type;

      if (hasActiveInternalDrag) {
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

        void addDroppedPaths(paths);
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
  }, [addDroppedPaths, hasActiveInternalDrag]);

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
        const colors = [
          "#3b82f6",
          "#ef4444",
          "#22c55e",
          "#f97316",
          "#8b5cf6",
          "#ec4899",
          "#14b8a6",
          "#eab308",
        ];
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
    onAddTagToItem: handleAddTagToItem,
    onRemoveTagFromItem: handleRemoveTagFromItem,
    onAddNewTagToItem: handleAddNewTagToItem,
    onToggleFavorite: toggleFavorite,
    onAddItemToCabinet: addItemToCabinet,
    onRemoveItemFromCabinet: removeItemFromCabinet,
    onUpdateThumbnail: updateItemIcon,
  };

  return (
    <ThemeProvider>
    <div className="flex h-screen select-none" style={{ backgroundColor: "var(--bg-base)", fontFamily: "var(--font-family)" }}>
      {/* 装饰层：樱花主题渐变光晕等 */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: "var(--bg-gradient)" }} />
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
      />
      <main
        className="flex-1 flex flex-col overflow-hidden relative"
        onDragEnter={handleMainDragEnter}
        onDragOver={handleMainDragOver}
        onDragLeave={handleMainDragLeave}
        onDrop={handleMainDrop}
      >
        <SearchBar onAddItem={addItem} onRefresh={refresh} onOpenAbout={handleOpenAbout} onOpenSettings={() => setShowSettings(true)} />
        <TagFilterBar />
        {viewMode === "grid" ? <ItemGrid {...viewProps} /> : <ItemListView {...viewProps} />}
        {dragOver && (
          <div className="absolute inset-0 bg-[var(--accent-primary-bg)] border-2 border-dashed border-[var(--accent-primary)] rounded-lg z-50 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-5xl mb-3">📁</div>
              <p className="text-[var(--accent-primary)] text-lg font-medium">释放以添加文件</p>
            </div>
          </div>
        )}
        {activeInternalDrag && (
          <div
            className="fixed z-[120] pointer-events-none"
            style={{ left: activeInternalDrag.x + 14, top: activeInternalDrag.y + 14 }}
          >
            <div className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow-2xl" style={{ backgroundColor: "var(--bg-elevated)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
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
        )}
      </main>
      <WelcomeModal open={showWelcomeModal} onClose={handleCloseWelcome} />
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
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

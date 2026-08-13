import { useState, useCallback, useEffect, useRef } from "react";
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
import { AiTaggingModal } from "./components/AiTaggingModal";
import { CommandPalette } from "./components/CommandPalette";
import { QuickPreview } from "./components/QuickPreview";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { StatusBar } from "./components/StatusBar";
import { useItems } from "./hooks/useItems";
import { useTags } from "./hooks/useTags";
import { useCabinets } from "./hooks/useCabinets";
import { useTagRelations } from "./hooks/useTagRelations";
import { useExternalFileDrop } from "./hooks/useExternalFileDrop";
import { useSidebarPanels } from "./hooks/useSidebarPanels";
import { useItemTagActions } from "./hooks/useItemTagActions";
import { useItemRemoval } from "./hooks/useItemRemoval";
import { useBatchSelection } from "./hooks/useBatchSelection";
import { useAiTagOrchestration } from "./hooks/useAiTagOrchestration";
import { TagGraphView } from "./components/TagGraphView";
import { useAppStore } from "./stores/appStore";
import { useInternalDragStore } from "./stores/internalDragStore";
import { loadSynonyms } from "./lib/synonyms";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { useStartupMaintenance } from "./hooks/useStartupMaintenance";
import { useWorkspaceHotkeys } from "./hooks/useWorkspaceHotkeys";
import { resetWorkspaceSearchInput } from "./lib/workspaceChrome";
import { initModApi, notifySelectionChanged, onTagsChanged, onCabinetsChanged, onItemsChanged } from "./lib/modApi";
import { initModRuntime } from "./lib/modRuntime";
import { ToastContainer } from "./components/ToastContainer";
import { FloatingPanels } from "./components/FloatingPanels";
import * as db from "./lib/db";

const WELCOME_HIDE_KEY = "taglauncher.hide_welcome_modal";

function App() {
  const {
    items,
    allItems,
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
  const { tags, addTag, updateTag, removeTag, refresh: refreshTags } = useTags();
  const { addCabinet, updateCabinet, removeCabinet, refresh: refreshCabinets } = useCabinets();
  const { addRelation: addTagRelation, removeRelation: removeTagRelation } = useTagRelations();
  const viewMode = useAppStore((state) => state.viewMode);
  const tagGraphOpen = useAppStore((state) => state.tagGraphOpen);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const shortcutsHelpOpen = useAppStore((state) => state.shortcutsHelpOpen);
  const clearWorkspaceFilters = useAppStore((state) => state.clearWorkspaceFilters);
  const cabinets = useAppStore((state) => state.cabinets);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const isDraggingItem = useInternalDragStore((state) => state.drag?.kind === "item");

  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);

  // 向 Mod 同步当前复选集合，使 Mod 可读取选择上下文并监听变化（onSelectionChanged）
  useEffect(() => {
    notifySelectionChanged(selectedItemIds);
  }, [selectedItemIds]);

  // 可见列表（items）变化时清理失效选中项。SelectionCanvas 内部有同样逻辑，但
  // 空列表分支会将其卸载、清理不再执行——此处兜底，避免筛选/删除为空后工具栏
  // 仍显示旧计数、且能对不可见项执行批量操作。
  useEffect(() => {
    setSelectedItemIds((current) => {
      if (current.length === 0) return current;
      const visible = new Set(items.map((item) => item.id));
      const next = current.filter((id) => visible.has(id));
      return next.length === current.length ? current : next;
    });
  }, [items]);

  // 桥接 Mod 数据变更到主 UI：mod 调用 api.addTag/removeTag/setItemTags/removeItem 等写操作后，
  // 主界面自动刷新对应数据，避免界面陈旧到重启。
  useEffect(() => {
    const unsubTags = onTagsChanged(() => {
      void refreshTags();
    });
    const unsubCabinets = onCabinetsChanged(() => {
      void refreshCabinets();
    });
    const unsubItems = onItemsChanged(() => {
      void refresh();
    });
    return () => {
      unsubTags();
      unsubCabinets();
      unsubItems();
    };
  }, [refresh, refreshTags, refreshCabinets]);

  const recentLaunchRef = useRef<Map<number, number>>(new Map());
  const [showSettings, setShowSettings] = useState(false);
  const { migration, dismissMigration } = useVersionCheck();
  // 启动期后台维护：在线更新检查（24h 节流）+ 自动云备份（需在设置中开启）
  useStartupMaintenance();
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WELCOME_HIDE_KEY) !== "1";
    } catch {
      return true;
    }
  });

  // 外部文件拖拽导入（原生 + DOM 双通道，dragOver 遮罩 + 落点去重）
  const { dragOver, dragHandlers } = useExternalFileDrop(addItems);

  // Sidebar 位置的 Mod 面板
  const sidebarPanels = useSidebarPanels();

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

  // 单对象标签动作：增删标签、新建并追加、清除当前筛选归类。
  const { addTagToItem, removeTagFromItem, addNewTagToItem, clearCurrentFilter } = useItemTagActions({
    findItemById,
    setItemTags,
    addTag,
    removeItemFromCabinet,
  });

  // 对象移除确认流（单个 / 批量）：读取"本次跳过"标记，需确认时挂起并交由弹窗渲染。
  const { requestRemoveFromApp, requestBatchRemoveFromApp, removeDialog } = useItemRemoval({
    removeItem,
    removeItems,
    selectedItemIds,
    setSelectedItemIds,
  });

  // 启动去抖：同一对象 300ms 内只真正启动一次，避免双击重复拉起进程。
  // 同时清理 1 分钟前的过期去抖记录，防止 recentLaunchRef 长期无限增长。
  const handleLaunchItem = useCallback(
    async (itemId: number) => {
      const now = Date.now();
      if (recentLaunchRef.current.size > 200) {
        for (const [id, ts] of recentLaunchRef.current) {
          if (now - ts > 60_000) recentLaunchRef.current.delete(id);
        }
      }
      const last = recentLaunchRef.current.get(itemId) ?? 0;
      if (now - last < 300) return;
      recentLaunchRef.current.set(itemId, now);
      // launchItem 失败时 withErrorToast 已弹 toast，这里吞掉 rejection 避免 unhandled 噪音
      await launchItem(itemId).catch(() => {});
    },
    [launchItem],
  );

  const handleSelectItems = useCallback((itemIds: number[]) => {
    setSelectedItemIds(itemIds);
  }, []);

  // 复选集合的批量动作 + 可移除标签并集。
  const {
    selectedItemsTags,
    batchAddTag,
    batchRemoveTag,
    batchAddToCabinet,
    batchRemoveFromCabinet,
  } = useBatchSelection({
    items,
    selectedItemIds,
    setSelectedItemIds,
    setManyItemTags,
    addItemsToCabinet,
    removeItemsFromCabinet,
  });

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

  const handleClearFilters = useCallback(() => {
    clearWorkspaceFilters();
    resetWorkspaceSearchInput();
  }, [clearWorkspaceFilters]);

  // AI 自动打标编排（一键打标 + 新对象后台自动打标）
  const { state: aiTagState, cancel: aiTagCancel, reset: aiTagReset } = useAiTagOrchestration({
    allItems,
    addTag,
    setItemTags,
  });

  const aiModalOpen = (aiTagState.running || aiTagState.done > 0) && !aiTagState.silent;
  const overlaysBlocked =
    showSettings ||
    showWelcomeModal ||
    tagGraphOpen ||
    removeDialog.open ||
    migration.show ||
    aiModalOpen ||
    commandPaletteOpen ||
    shortcutsHelpOpen;

  useWorkspaceHotkeys({
    blocked: overlaysBlocked,
    items,
    selectedItemIds,
    setSelectedItemIds,
    onLaunch: (id) => { void handleLaunchItem(id); },
    onRemoveSelected: () => { void requestBatchRemoveFromApp(); },
    onOpenSettings: () => setShowSettings(true),
  });

  // 回收标签编辑器取消时未落库的新建空标签（逐个删除，removeTag 内部已同步清理筛选状态）
  const recycleNewTags = useCallback(
    async (tagIds: number[]) => {
      for (const id of tagIds) {
        await removeTag(id).catch(() => {});
      }
    },
    [removeTag],
  );

  const viewProps = {
    items,
    tags,
    cabinets,
    loading,
    currentCabinetId: selectedCabinetId,
    onLaunch: handleLaunchItem,
    onSetTags: setItemTags,
    onSetManyTags: setManyItemTags,
    onAddTagToItem: addTagToItem,
    onRemoveTagFromItem: removeTagFromItem,
    onAddNewTagToItem: addNewTagToItem,
    onRecycleNewTags: recycleNewTags,
    onToggleFavorite: toggleFavorite,
    onAddItemToCabinet: addItemToCabinet,
    onAddItemsToCabinet: addItemsToCabinet,
    onRemoveItemFromCabinet: removeItemFromCabinet,
    onRemoveItemsFromCabinet: removeItemsFromCabinet,
    onClearCurrentFilter: clearCurrentFilter,
    onRequestRemoveFromApp: requestRemoveFromApp,
    onUpdateThumbnail: updateItemIcon,
    selectedItemIds,
    onSelectItems: handleSelectItems,
    libraryEmpty: allItems.length === 0,
    onClearFilters: handleClearFilters,
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
        onAddTagToItem={addTagToItem}
        onAddTagRelation={addTagRelation}
        onRemoveTagRelation={removeTagRelation}
        allItems={allItems}
        modPanels={sidebarPanels}
      />
      <main
        data-region="main"
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-surface)]"
        {...dragHandlers}
      >
        <SearchBar onAddItems={addItems} onRefresh={refresh} onOpenAbout={handleOpenAbout} onOpenSettings={() => setShowSettings(true)} />
        <TagFilterBar />
        {viewMode === "grid" ? <ItemGrid {...viewProps} /> : <ItemListView {...viewProps} />}
        <BatchSelectionToolbar
          selectedCount={isDraggingItem ? 0 : selectedItemIds.length}
          totalCount={items.length}
          tags={tags}
          removableTags={selectedItemsTags}
          cabinets={cabinets}
          canRemoveFromCabinet={selectedCabinetId !== null}
          onAddTag={batchAddTag}
          onRemoveTag={batchRemoveTag}
          onAddToCabinet={batchAddToCabinet}
          onRemoveFromCabinet={batchRemoveFromCabinet}
          onRemoveFromApp={requestBatchRemoveFromApp}
          onSelectAll={() => setSelectedItemIds(items.map((item) => item.id))}
          onClearSelection={() => setSelectedItemIds([])}
        />
        <StatusBar
          visibleCount={items.length}
          selectedCount={selectedItemIds.length}
          libraryCount={allItems.length}
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
      <CommandPalette
        items={allItems}
        onLaunch={(id) => { void handleLaunchItem(id); }}
        onAddItems={addItems}
        onRefresh={refresh}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAbout={handleOpenAbout}
      />
      <QuickPreview items={allItems} onLaunch={(id) => { void handleLaunchItem(id); }} />
      <ShortcutsHelp />
      <RemoveFromAppConfirmDialog {...removeDialog} />
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
      <AiTaggingModal progress={aiTagState} onCancel={aiTagCancel} onClose={aiTagReset} />
      {tagGraphOpen && <TagGraphView allItems={allItems} />}
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

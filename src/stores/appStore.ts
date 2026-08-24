// ============================================================================
// stores/appStore.ts — Zustand 全局状态管理
// ============================================================================
// 使用 Zustand 管理应用的全局状态，包括数据缓存、筛选条件和 UI 状态。
// 核心设计：标签筛选、文件柜筛选、收藏夹、最近使用 四种模式互斥。
// 视图偏好（视图/搜索模式/排序/类型筛选）持久化到 localStorage。
// ============================================================================

import { create } from "zustand";
import type { Tag, Cabinet, TagRelation } from "../types";
import {
  isSortMode,
  isTypeFilter,
  type SortMode,
  type TypeFilter,
} from "../lib/itemQuery";

function sameTags(a: Tag[], b: Tag[]): boolean {
  return a.length === b.length && a.every((tag, index) =>
    tag.id === b[index].id &&
    tag.name === b[index].name &&
    tag.color === b[index].color,
  );
}

function sameRelations(a: TagRelation[], b: TagRelation[]): boolean {
  return a.length === b.length && a.every((rel, index) =>
    rel.parentId === b[index].parentId && rel.childId === b[index].childId,
  );
}

function sameCabinets(a: Cabinet[], b: Cabinet[]): boolean {
  return a.length === b.length && a.every((cabinet, index) =>
    cabinet.id === b[index].id &&
    cabinet.name === b[index].name &&
    cabinet.color === b[index].color &&
    cabinet.created_at === b[index].created_at,
  );
}

function sameNumberArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 搜索模式：全部 / 仅名称路径 / 仅标签 */
export type SearchMode = "all" | "name" | "tag";

/** 侧边栏页签：标签 / 文件柜 */
export type SidebarTab = "tags" | "cabinets";

export type { SortMode, TypeFilter };

const PREFS_KEY = "taglauncher.workspace_prefs";

interface WorkspacePrefs {
  viewMode?: "grid" | "list";
  searchMode?: SearchMode;
  sortMode?: SortMode;
  typeFilter?: TypeFilter;
}

function loadWorkspacePrefs(): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      viewMode: parsed.viewMode === "list" || parsed.viewMode === "grid" ? parsed.viewMode : undefined,
      searchMode: parsed.searchMode === "all" || parsed.searchMode === "name" || parsed.searchMode === "tag"
        ? parsed.searchMode
        : undefined,
      sortMode: isSortMode(parsed.sortMode) ? parsed.sortMode : undefined,
      typeFilter: isTypeFilter(parsed.typeFilter) ? parsed.typeFilter : undefined,
    };
  } catch {
    return {};
  }
}

function persistWorkspacePrefs(prefs: Required<WorkspacePrefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式或配额不足时忽略
  }
}

const initialPrefs = loadWorkspacePrefs();

interface AppState {
  // ---- 数据缓存 ----
  tags: Tag[];
  tagRelations: TagRelation[];
  cabinets: Cabinet[];

  // ---- 筛选状态（四者互斥） ----
  selectedTagIds: number[];
  selectedCabinetId: number | null;
  showFavorites: boolean;
  showRecent: boolean;

  // ---- UI 状态 ----
  sidebarTab: SidebarTab;
  searchQuery: string;
  /**
   * 搜索框中的即时输入值（未经防抖）。与 searchQuery 不一致时表示
   * 防抖窗口内还有待生效的搜索输入，StatusBar 据此显示"搜索中"指示。
   */
  searchInputValue: string;
  searchMode: SearchMode;
  viewMode: "grid" | "list";
  sortMode: SortMode;
  typeFilter: TypeFilter;
  tagGraphOpen: boolean;
  commandPaletteOpen: boolean;
  shortcutsHelpOpen: boolean;
  previewItemId: number | null;

  // ---- Actions ----
  setTags: (tags: Tag[]) => void;
  setTagRelations: (relations: TagRelation[]) => void;
  setCabinets: (cabinets: Cabinet[]) => void;
  setSelectedTagIds: (ids: number[]) => void;
  toggleTagSelection: (id: number) => void;
  setSelectedCabinetId: (id: number | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setShowFavorites: (v: boolean) => void;
  setShowRecent: (v: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchInputValue: (value: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setViewMode: (mode: "grid" | "list") => void;
  setSortMode: (mode: SortMode) => void;
  setTypeFilter: (filter: TypeFilter) => void;
  setTagGraphOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setPreviewItemId: (id: number | null) => void;
  clearWorkspaceFilters: () => void;
}

export const useAppStore = create<AppState>((set, get) => {
  const persistNow = () => {
    const state = get();
    persistWorkspacePrefs({
      viewMode: state.viewMode,
      searchMode: state.searchMode,
      sortMode: state.sortMode,
      typeFilter: state.typeFilter,
    });
  };

  return {
  tags: [],
  tagRelations: [],
  cabinets: [],
  selectedTagIds: [],
  selectedCabinetId: null,
  sidebarTab: "tags",
  showFavorites: false,
  showRecent: false,
  searchQuery: "",
  searchInputValue: "",
  searchMode: initialPrefs.searchMode ?? "all",
  viewMode: initialPrefs.viewMode ?? "grid",
  sortMode: initialPrefs.sortMode ?? "smart",
  typeFilter: initialPrefs.typeFilter ?? "all",
  tagGraphOpen: false,
  commandPaletteOpen: false,
  shortcutsHelpOpen: false,
  previewItemId: null,

  setTags: (tags) => set((state) => sameTags(state.tags, tags) ? state : { tags }),
  setTagRelations: (relations) => set((state) => sameRelations(state.tagRelations, relations) ? state : { tagRelations: relations }),
  setCabinets: (cabinets) => set((state) => sameCabinets(state.cabinets, cabinets) ? state : { cabinets }),
  setSelectedTagIds: (ids) => set((state) =>
    sameNumberArray(state.selectedTagIds, ids) &&
    state.selectedCabinetId === null &&
    !state.showFavorites &&
    !state.showRecent
      ? state
      : { selectedTagIds: ids, selectedCabinetId: null, showFavorites: false, showRecent: false },
  ),

  toggleTagSelection: (id) =>
    set((state) => ({
      selectedTagIds: state.selectedTagIds.includes(id)
        ? state.selectedTagIds.filter((i) => i !== id)
        : [...state.selectedTagIds, id],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
    })),

  setSelectedCabinetId: (id) => set((state) =>
    state.selectedCabinetId === id &&
    state.selectedTagIds.length === 0 &&
    !state.showFavorites &&
    !state.showRecent
      ? state
      : { selectedCabinetId: id, selectedTagIds: [], showFavorites: false, showRecent: false },
  ),

  setSidebarTab: (tab) =>
    set((state) =>
      tab === "tags"
        ? state.sidebarTab === tab && state.selectedCabinetId === null && !state.showFavorites && !state.showRecent
          ? state
          : { sidebarTab: tab, selectedCabinetId: null, showFavorites: false, showRecent: false }
        : state.sidebarTab === tab && state.selectedTagIds.length === 0 && !state.showFavorites && !state.showRecent
          ? state
          : { sidebarTab: tab, selectedTagIds: [], showFavorites: false, showRecent: false },
    ),

  setShowFavorites: (v) => set((state) =>
    state.showFavorites === v &&
    state.selectedCabinetId === null &&
    state.selectedTagIds.length === 0 &&
    !state.showRecent
      ? state
      : { showFavorites: v, selectedCabinetId: null, selectedTagIds: [], showRecent: false },
  ),

  setShowRecent: (v) => set((state) =>
    state.showRecent === v &&
    state.selectedCabinetId === null &&
    state.selectedTagIds.length === 0 &&
    !state.showFavorites
      ? state
      : { showRecent: v, selectedCabinetId: null, selectedTagIds: [], showFavorites: false },
  ),

  // 直接设置搜索词（跳过防抖）时同步即时输入值，保证"防抖待生效"指示不会误亮。
  // 防抖路径（useSearch）会先单独写 searchInputValue，等定时器到期再走这里收敛。
  setSearchQuery: (query) => set((state) =>
    state.searchQuery === query && state.searchInputValue === query
      ? state
      : { searchQuery: query, searchInputValue: query },
  ),
  setSearchInputValue: (value) => set((state) => state.searchInputValue === value ? state : { searchInputValue: value }),
  setSearchMode: (mode) => {
    if (get().searchMode === mode) return;
    set({ searchMode: mode });
    persistNow();
  },
  setViewMode: (mode) => {
    if (get().viewMode === mode) return;
    set({ viewMode: mode });
    persistNow();
  },
  setSortMode: (mode) => {
    if (get().sortMode === mode) return;
    set({ sortMode: mode });
    persistNow();
  },
  setTypeFilter: (filter) => {
    if (get().typeFilter === filter) return;
    set({ typeFilter: filter });
    persistNow();
  },
  setTagGraphOpen: (open) => set((state) => state.tagGraphOpen === open ? state : { tagGraphOpen: open }),
  setCommandPaletteOpen: (open) => set((state) => state.commandPaletteOpen === open ? state : { commandPaletteOpen: open }),
  setShortcutsHelpOpen: (open) => set((state) => state.shortcutsHelpOpen === open ? state : { shortcutsHelpOpen: open }),
  setPreviewItemId: (id) => set((state) => state.previewItemId === id ? state : { previewItemId: id }),
  clearWorkspaceFilters: () => {
    set({
      selectedTagIds: [],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
      typeFilter: "all",
      searchQuery: "",
      searchInputValue: "",
    });
    persistNow();
  },
  };
});

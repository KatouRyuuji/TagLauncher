// ============================================================================
// stores/appStore.ts — Zustand 全局状态管理
// ============================================================================
// 使用 Zustand 管理应用的全局状态，包括数据缓存、筛选条件和 UI 状态。
// 核心设计：标签筛选、文件柜筛选、收藏夹三种模式互斥。
// ============================================================================

import { create } from "zustand";
import type { Tag, Cabinet, TagRelation } from "../types";

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

interface AppState {
  // ---- 数据缓存 ----
  tags: Tag[];                 // 所有标签
  tagRelations: TagRelation[]; // 标签父子关系边（DAG，多继承）
  cabinets: Cabinet[];         // 所有文件柜

  // ---- 筛选状态（三者互斥） ----
  selectedTagIds: number[];    // 选中的标签 ID 列表（支持多选）
  selectedCabinetId: number | null;  // 选中的文件柜 ID（单选）
  showFavorites: boolean;      // 是否显示收藏夹

  // ---- UI 状态 ----
  sidebarTab: SidebarTab;      // 侧边栏当前页签
  searchQuery: string;         // 搜索关键词
  searchMode: SearchMode;      // 搜索模式
  viewMode: "grid" | "list";   // 视图模式：网格 / 列表
  tagGraphOpen: boolean;       // 是否打开独立标签关系图视图（单独模式）

  // ---- Actions ----
  setTags: (tags: Tag[]) => void;
  setTagRelations: (relations: TagRelation[]) => void;
  setCabinets: (cabinets: Cabinet[]) => void;
  setSelectedTagIds: (ids: number[]) => void;
  toggleTagSelection: (id: number) => void;
  setSelectedCabinetId: (id: number | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setShowFavorites: (v: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setViewMode: (mode: "grid" | "list") => void;
  setTagGraphOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // 初始状态
  tags: [],
  tagRelations: [],
  cabinets: [],
  selectedTagIds: [],
  selectedCabinetId: null,
  sidebarTab: "tags",
  showFavorites: false,
  searchQuery: "",
  searchMode: "all",
  viewMode: "grid",
  tagGraphOpen: false,

  // 简单 setter
  setTags: (tags) => set((state) => sameTags(state.tags, tags) ? state : { tags }),
  setTagRelations: (relations) => set((state) => sameRelations(state.tagRelations, relations) ? state : { tagRelations: relations }),
  setCabinets: (cabinets) => set((state) => sameCabinets(state.cabinets, cabinets) ? state : { cabinets }),
  setSelectedTagIds: (ids) => set((state) =>
    sameNumberArray(state.selectedTagIds, ids) &&
    state.selectedCabinetId === null &&
    !state.showFavorites
      ? state
      : { selectedTagIds: ids, selectedCabinetId: null, showFavorites: false },
  ),

  // 切换标签选中状态（支持多选）
  // 关键：切换标签时自动清空文件柜和收藏夹，保证三种筛选模式互斥
  toggleTagSelection: (id) =>
    set((state) => ({
      selectedTagIds: state.selectedTagIds.includes(id)
        ? state.selectedTagIds.filter((i) => i !== id)  // 已选中 → 取消选中
        : [...state.selectedTagIds, id],                 // 未选中 → 添加选中
      selectedCabinetId: null,   // 互斥：清空文件柜选择
      showFavorites: false,      // 互斥：关闭收藏夹
    })),

  // 选择文件柜（互斥：清空标签和收藏夹）
  setSelectedCabinetId: (id) => set((state) =>
    state.selectedCabinetId === id &&
    state.selectedTagIds.length === 0 &&
    !state.showFavorites
      ? state
      : { selectedCabinetId: id, selectedTagIds: [], showFavorites: false },
  ),

  setSidebarTab: (tab) =>
    set((state) =>
      tab === "tags"
        ? state.sidebarTab === tab && state.selectedCabinetId === null && !state.showFavorites
          ? state
          : { sidebarTab: tab, selectedCabinetId: null, showFavorites: false }
        : state.sidebarTab === tab && state.selectedTagIds.length === 0 && !state.showFavorites
          ? state
          : { sidebarTab: tab, selectedTagIds: [], showFavorites: false },
    ),

  // 切换收藏夹（互斥：清空文件柜和标签）
  setShowFavorites: (v) => set((state) =>
    state.showFavorites === v &&
    state.selectedCabinetId === null &&
    state.selectedTagIds.length === 0
      ? state
      : { showFavorites: v, selectedCabinetId: null, selectedTagIds: [] },
  ),

  setSearchQuery: (query) => set((state) => state.searchQuery === query ? state : { searchQuery: query }),
  setSearchMode: (mode) => set((state) => state.searchMode === mode ? state : { searchMode: mode }),
  setViewMode: (mode) => set((state) => state.viewMode === mode ? state : { viewMode: mode }),
  setTagGraphOpen: (open) => set((state) => state.tagGraphOpen === open ? state : { tagGraphOpen: open }),
}));

// ============================================================================
// stores/appStore.ts — Zustand 全局状态管理
// ============================================================================
// 使用 Zustand 管理应用的全局状态，包括数据缓存、筛选条件和 UI 状态。
// 核心设计：标签筛选、文件柜筛选、收藏夹三种模式互斥。
// ============================================================================

import { create } from "zustand";
import type { Tag, ItemWithTags, Cabinet } from "../types";

/** 搜索模式：全部 / 仅名称路径 / 仅标签 */
export type SearchMode = "all" | "name" | "tag";

/** 侧边栏页签：标签 / 文件柜 */
export type SidebarTab = "tags" | "cabinets";

interface AppState {
  // ---- 数据缓存 ----
  items: ItemWithTags[];       // 当前显示的项目列表（经过筛选和搜索）
  tags: Tag[];                 // 所有标签
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

  // ---- Actions ----
  setItems: (items: ItemWithTags[]) => void;
  setTags: (tags: Tag[]) => void;
  setCabinets: (cabinets: Cabinet[]) => void;
  setSelectedTagIds: (ids: number[]) => void;
  toggleTagSelection: (id: number) => void;
  setSelectedCabinetId: (id: number | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setShowFavorites: (v: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setViewMode: (mode: "grid" | "list") => void;
}

export const useAppStore = create<AppState>((set) => ({
  // 初始状态
  items: [],
  tags: [],
  cabinets: [],
  selectedTagIds: [],
  selectedCabinetId: null,
  sidebarTab: "tags",
  showFavorites: false,
  searchQuery: "",
  searchMode: "all",
  viewMode: "grid",

  // 简单 setter
  setItems: (items) => set({ items }),
  setTags: (tags) => set({ tags }),
  setCabinets: (cabinets) => set({ cabinets }),
  setSelectedTagIds: (ids) => set({ selectedTagIds: ids }),

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
  setSelectedCabinetId: (id) => set({ selectedCabinetId: id, selectedTagIds: [], showFavorites: false }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  // 切换收藏夹（互斥：清空文件柜和标签）
  setShowFavorites: (v) => set({ showFavorites: v, selectedCabinetId: null, selectedTagIds: [] }),

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),
}));

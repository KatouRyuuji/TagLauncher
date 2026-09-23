// ============================================================================
// src/stores/appStore.spec.ts — appStore 状态单元测试
// ============================================================================
// 验证筛选互斥、标签/文件柜选择、搜索词、图谱开关等核心状态切换。
// Zustand store 不依赖 Tauri，适合作为 vitest 首个落地用例。
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SEARCH_RESET_EVENT } from "../lib/workspaceChrome";
import { useAppStore } from "./appStore";

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      tags: [],
      tagRelations: [],
      cabinets: [],
      selectedTagIds: [],
      excludedTagIds: [],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
      searchQuery: "",
      searchInputValue: "",
      searchMode: "all",
      viewMode: "grid",
      sortMode: "smart",
      typeFilter: "all",
      cardSizeScale: 1,
      iconSizeScale: 1,
      workspaceFiltersOpen: false,
      tagGraphOpen: false,
      commandPaletteOpen: false,
      shortcutsHelpOpen: false,
      previewItemId: null,
      missingReviewOpen: false,
    });
  });

  it("setSelectedTagIds 会清空文件柜与收藏筛选", () => {
    useAppStore.setState({ selectedCabinetId: 1, showFavorites: true });

    useAppStore.getState().setSelectedTagIds([10, 20]);

    expect(useAppStore.getState().selectedTagIds).toEqual([10, 20]);
    expect(useAppStore.getState().selectedCabinetId).toBeNull();
    expect(useAppStore.getState().showFavorites).toBe(false);
  });

  it("toggleTagExclusion 反选标签，与正选互斥", () => {
    useAppStore.setState({ selectedTagIds: [10], selectedCabinetId: 2, showFavorites: true });

    // 正选中的标签被反选：从正选移除、加入反选，并清空文件柜/收藏
    useAppStore.getState().toggleTagExclusion(10);
    expect(useAppStore.getState().excludedTagIds).toEqual([10]);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().selectedCabinetId).toBeNull();
    expect(useAppStore.getState().showFavorites).toBe(false);

    // 再次反选 = 取消
    useAppStore.getState().toggleTagExclusion(10);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });

  it("toggleTagSelection 正选时撤销该标签的反选", () => {
    useAppStore.setState({ excludedTagIds: [10] });

    useAppStore.getState().toggleTagSelection(10);

    expect(useAppStore.getState().selectedTagIds).toEqual([10]);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });

  it("setSelectedTagIds([]) 同时清空反选（回到全部标签）", () => {
    useAppStore.setState({ selectedTagIds: [1], excludedTagIds: [2] });

    useAppStore.getState().setSelectedTagIds([]);

    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });

  it("setSelectedCabinetId 会清空标签正反选与收藏筛选", () => {
    useAppStore.setState({ selectedTagIds: [10], excludedTagIds: [11], showFavorites: true });

    useAppStore.getState().setSelectedCabinetId(2);

    expect(useAppStore.getState().selectedCabinetId).toBe(2);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
    expect(useAppStore.getState().showFavorites).toBe(false);
  });

  it("setSelectedCabinetId 会清空标签与收藏筛选", () => {
    useAppStore.setState({ selectedTagIds: [10], showFavorites: true });

    useAppStore.getState().setSelectedCabinetId(2);

    expect(useAppStore.getState().selectedCabinetId).toBe(2);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().showFavorites).toBe(false);
  });

  it("setShowFavorites(true) 会清空标签与文件柜筛选", () => {
    useAppStore.setState({ selectedTagIds: [10], selectedCabinetId: 2 });

    useAppStore.getState().setShowFavorites(true);

    expect(useAppStore.getState().showFavorites).toBe(true);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().selectedCabinetId).toBeNull();
  });

  it("setSidebarTab 只切换侧栏页签，不清空全部 / 收藏 / 文件柜筛选", () => {
    useAppStore.setState({ sidebarTab: "tags", selectedTagIds: [10], showFavorites: true, selectedCabinetId: 2 });

    useAppStore.getState().setSidebarTab("cabinets");

    expect(useAppStore.getState().sidebarTab).toBe("cabinets");
    expect(useAppStore.getState().selectedTagIds).toEqual([10]);
    expect(useAppStore.getState().showFavorites).toBe(true);
    expect(useAppStore.getState().selectedCabinetId).toBe(2);
  });

  it("setSearchQuery 更新搜索词并同步即时输入值（跳过防抖的直达路径）", () => {
    useAppStore.setState({ searchInputValue: "残留输入" });

    useAppStore.getState().setSearchQuery("忍者神龟");

    expect(useAppStore.getState().searchQuery).toBe("忍者神龟");
    expect(useAppStore.getState().searchInputValue).toBe("忍者神龟");
  });

  it("setSearchInputValue 只更新即时输入值，不触碰生效中的搜索词", () => {
    useAppStore.setState({ searchQuery: "旧词" });

    useAppStore.getState().setSearchInputValue("旧词新增");

    expect(useAppStore.getState().searchInputValue).toBe("旧词新增");
    expect(useAppStore.getState().searchQuery).toBe("旧词");
  });

  it("setTagGraphOpen 切换图谱开关", () => {
    useAppStore.getState().setTagGraphOpen(true);
    expect(useAppStore.getState().tagGraphOpen).toBe(true);
  });

  it("setShowRecent(true) 会清空标签、文件柜与收藏筛选", () => {
    useAppStore.setState({ selectedTagIds: [10], selectedCabinetId: 2, showFavorites: true });

    useAppStore.getState().setShowRecent(true);

    expect(useAppStore.getState().showRecent).toBe(true);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().selectedCabinetId).toBeNull();
    expect(useAppStore.getState().showFavorites).toBe(false);
  });

  it("setShowFavorites(true) 会清空最近使用筛选", () => {
    useAppStore.setState({ showRecent: true });
    useAppStore.getState().setShowFavorites(true);
    expect(useAppStore.getState().showFavorites).toBe(true);
    expect(useAppStore.getState().showRecent).toBe(false);
  });

  it("clearWorkspaceFilters 重置互斥筛选、类型筛选、搜索模式与搜索词", () => {
    useAppStore.setState({
      selectedTagIds: [1],
      excludedTagIds: [2],
      showFavorites: true,
      showRecent: true,
      typeFilter: "image",
      searchMode: "name",
      searchQuery: "游戏",
      searchInputValue: "游戏机",
      sortMode: "name",
    });

    useAppStore.getState().clearWorkspaceFilters();

    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
    expect(useAppStore.getState().showFavorites).toBe(false);
    expect(useAppStore.getState().showRecent).toBe(false);
    expect(useAppStore.getState().typeFilter).toBe("all");
    expect(useAppStore.getState().searchMode).toBe("all");
    expect(useAppStore.getState().searchQuery).toBe("");
    expect(useAppStore.getState().searchInputValue).toBe("");
    expect(useAppStore.getState().sortMode).toBe("name");
  });

  it("clearWorkspaceFilters 把 searchMode 写回 workspace_prefs", () => {
    useAppStore.getState().setSearchMode("tag");
    useAppStore.getState().clearWorkspaceFilters();
    const stored = JSON.parse(localStorage.getItem("taglauncher.workspace_prefs") ?? "{}") as {
      searchMode?: string;
    };
    expect(useAppStore.getState().searchMode).toBe("all");
    expect(stored.searchMode).toBe("all");
  });

  it("clearWorkspaceFilters 派发搜索框重置事件", () => {
    const listener = vi.fn();
    window.addEventListener(SEARCH_RESET_EVENT, listener);
    useAppStore.getState().clearWorkspaceFilters();
    window.removeEventListener(SEARCH_RESET_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("setSortMode / setTypeFilter 更新工作台偏好", () => {
    useAppStore.getState().setSortMode("recent");
    useAppStore.getState().setTypeFilter("script");
    expect(useAppStore.getState().sortMode).toBe("recent");
    expect(useAppStore.getState().typeFilter).toBe("script");
  });

  it("setViewMode 支持大图标", () => {
    useAppStore.getState().setViewMode("icons");
    expect(useAppStore.getState().viewMode).toBe("icons");
  });

  it("setCardSizeScale 夹取范围、写 CSS 变量并持久化", () => {
    useAppStore.getState().setCardSizeScale(1.25);
    expect(useAppStore.getState().cardSizeScale).toBe(1.25);
    expect(document.documentElement.style.getPropertyValue("--grid-col-min")).toBe("320px");
    expect(document.documentElement.style.getPropertyValue("--card-thumb-size")).toBe("50px");
    const stored = JSON.parse(localStorage.getItem("taglauncher.workspace_prefs") ?? "{}") as {
      cardSizeScale?: number;
    };
    expect(stored.cardSizeScale).toBe(1.25);

    // 超界夹取到上限
    useAppStore.getState().setCardSizeScale(99);
    expect(useAppStore.getState().cardSizeScale).toBe(1.5);

    // 回到默认值移除内联覆盖，交还主题样式表注册的变量
    useAppStore.getState().setCardSizeScale(1);
    expect(useAppStore.getState().cardSizeScale).toBe(1);
    expect(document.documentElement.style.getPropertyValue("--grid-col-min")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--card-thumb-size")).toBe("");
  });

  it("setIconSizeScale 夹取范围、写大图标列宽变量并持久化", () => {
    useAppStore.getState().setIconSizeScale(1.5);
    expect(useAppStore.getState().iconSizeScale).toBe(1.5);
    expect(document.documentElement.style.getPropertyValue("--grid-col-min-icons")).toBe("252px");
    const stored = JSON.parse(localStorage.getItem("taglauncher.workspace_prefs") ?? "{}") as {
      iconSizeScale?: number;
    };
    expect(stored.iconSizeScale).toBe(1.5);

    useAppStore.getState().setIconSizeScale(0.1);
    expect(useAppStore.getState().iconSizeScale).toBe(0.7);

    useAppStore.getState().setIconSizeScale(1);
    expect(document.documentElement.style.getPropertyValue("--grid-col-min-icons")).toBe("");
  });

  it("无偏好时 workspaceFiltersOpen 默认为收起", () => {
    expect(useAppStore.getState().workspaceFiltersOpen).toBe(false);
  });

  it("setWorkspaceFiltersOpen 写入 workspace_prefs 并记住收起", () => {
    useAppStore.getState().setWorkspaceFiltersOpen(false);
    const storedClosed = JSON.parse(localStorage.getItem("taglauncher.workspace_prefs") ?? "{}") as {
      workspaceFiltersOpen?: boolean;
    };
    expect(useAppStore.getState().workspaceFiltersOpen).toBe(false);
    expect(storedClosed.workspaceFiltersOpen).toBe(false);

    useAppStore.getState().setWorkspaceFiltersOpen(true);
    const storedOpen = JSON.parse(localStorage.getItem("taglauncher.workspace_prefs") ?? "{}") as {
      workspaceFiltersOpen?: boolean;
    };
    expect(useAppStore.getState().workspaceFiltersOpen).toBe(true);
    expect(storedOpen.workspaceFiltersOpen).toBe(true);
  });
});

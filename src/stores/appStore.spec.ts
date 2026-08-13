// ============================================================================
// src/stores/appStore.spec.ts — appStore 状态单元测试
// ============================================================================
// 验证筛选互斥、标签/文件柜选择、搜索词、图谱开关等核心状态切换。
// Zustand store 不依赖 Tauri，适合作为 vitest 首个落地用例。
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      tags: [],
      tagRelations: [],
      cabinets: [],
      selectedTagIds: [],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
      searchQuery: "",
      searchMode: "all",
      viewMode: "grid",
      sortMode: "smart",
      typeFilter: "all",
      tagGraphOpen: false,
      commandPaletteOpen: false,
      shortcutsHelpOpen: false,
      previewItemId: null,
    });
  });

  it("setSelectedTagIds 会清空文件柜与收藏筛选", () => {
    useAppStore.setState({ selectedCabinetId: 1, showFavorites: true });

    useAppStore.getState().setSelectedTagIds([10, 20]);

    expect(useAppStore.getState().selectedTagIds).toEqual([10, 20]);
    expect(useAppStore.getState().selectedCabinetId).toBeNull();
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

  it("setSidebarTab('cabinets') 会清空标签与收藏筛选（页签与主视图保持一致）", () => {
    useAppStore.setState({ sidebarTab: "tags", selectedTagIds: [10], showFavorites: true });

    useAppStore.getState().setSidebarTab("cabinets");

    expect(useAppStore.getState().sidebarTab).toBe("cabinets");
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().showFavorites).toBe(false);
  });

  it("setSidebarTab('tags') 会清空文件柜与收藏筛选", () => {
    useAppStore.setState({ sidebarTab: "cabinets", selectedCabinetId: 2, showFavorites: true });

    useAppStore.getState().setSidebarTab("tags");

    expect(useAppStore.getState().sidebarTab).toBe("tags");
    expect(useAppStore.getState().selectedCabinetId).toBeNull();
    expect(useAppStore.getState().showFavorites).toBe(false);
  });

  it("setSearchQuery 更新搜索词", () => {
    useAppStore.getState().setSearchQuery("忍者神龟");
    expect(useAppStore.getState().searchQuery).toBe("忍者神龟");
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

  it("clearWorkspaceFilters 重置互斥筛选、类型筛选与搜索词", () => {
    useAppStore.setState({
      selectedTagIds: [1],
      showFavorites: true,
      showRecent: true,
      typeFilter: "image",
      searchQuery: "游戏",
      sortMode: "name",
    });

    useAppStore.getState().clearWorkspaceFilters();

    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(useAppStore.getState().showFavorites).toBe(false);
    expect(useAppStore.getState().showRecent).toBe(false);
    expect(useAppStore.getState().typeFilter).toBe("all");
    expect(useAppStore.getState().searchQuery).toBe("");
    expect(useAppStore.getState().sortMode).toBe("name");
  });

  it("setSortMode / setTypeFilter 更新工作台偏好", () => {
    useAppStore.getState().setSortMode("recent");
    useAppStore.getState().setTypeFilter("script");
    expect(useAppStore.getState().sortMode).toBe("recent");
    expect(useAppStore.getState().typeFilter).toBe("script");
  });
});

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
      searchQuery: "",
      searchMode: "all",
      viewMode: "grid",
      tagGraphOpen: false,
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

  it("setSearchQuery 更新搜索词", () => {
    useAppStore.getState().setSearchQuery("忍者神龟");
    expect(useAppStore.getState().searchQuery).toBe("忍者神龟");
  });

  it("setTagGraphOpen 切换图谱开关", () => {
    useAppStore.getState().setTagGraphOpen(true);
    expect(useAppStore.getState().tagGraphOpen).toBe(true);
  });
});

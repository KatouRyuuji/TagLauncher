// ============================================================================
// src/components/StatusBar.spec.tsx — 状态栏搜索"待生效"指示测试
// ============================================================================
// 搜索输入在 150ms 防抖窗口内时（searchInputValue !== searchQuery），
// 状态栏应显示"搜索中…"指示，提示当前计数对应的还是上一次搜索词。
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useAppStore } from "../stores/appStore";

function renderStatusBar() {
  return render(
    <StatusBar
      visibleCount={3}
      selectedCount={0}
      libraryCount={10}
      missingCount={0}
      onRelocateMissing={async () => 0}
    />,
  );
}

describe("StatusBar 搜索指示", () => {
  beforeEach(() => {
    useAppStore.setState({
      searchQuery: "",
      searchInputValue: "",
      sortMode: "smart",
      typeFilter: "all",
      showFavorites: false,
      showRecent: false,
      selectedTagIds: [],
      selectedCabinetId: null,
    });
  });

  it("防抖窗口内（输入值与生效搜索词不一致）显示搜索中指示", () => {
    useAppStore.setState({ searchQuery: "旧词", searchInputValue: "旧词新增" });
    renderStatusBar();
    expect(screen.getByTestId("search-pending")).toBeInTheDocument();
    expect(screen.getByTestId("search-pending")).toHaveTextContent("搜索中");
  });

  it("搜索词已生效（两者一致）时不显示指示", () => {
    useAppStore.setState({ searchQuery: "游戏", searchInputValue: "游戏" });
    renderStatusBar();
    expect(screen.queryByTestId("search-pending")).not.toBeInTheDocument();
  });

  it("无搜索时不显示指示", () => {
    renderStatusBar();
    expect(screen.queryByTestId("search-pending")).not.toBeInTheDocument();
  });
});

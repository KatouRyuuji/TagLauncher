// ============================================================================
// src/components/StatusBar.spec.tsx — 状态栏搜索"待生效"指示测试
// ============================================================================
// 搜索输入在 150ms 防抖窗口内时（searchInputValue !== searchQuery），
// 状态栏应显示"搜索中…"指示，提示当前计数对应的还是上一次搜索词。
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";

const missingItems: ItemWithTags[] = [
  {
    id: 1,
    name: "失效影片",
    path: "E:\\Videos\\gone.mp4",
    type: "video",
    created_at: "2026-01-01T00:00:00Z",
    is_favorite: false,
    is_missing: true,
    tags: [],
  },
  {
    id: 2,
    name: "失效程序",
    path: "E:\\Apps\\gone.exe",
    type: "exe",
    created_at: "2026-01-01T00:00:00Z",
    is_favorite: false,
    is_missing: true,
    tags: [],
  },
];

function renderStatusBar() {
  return render(
    <StatusBar
      visibleCount={3}
      libraryCount={10}
      missingItems={[]}
      onRelocateMissing={async () => 0}
      onRemoveMissing={async () => {}}
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

describe("StatusBar 失效对象找回", () => {
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
      missingReviewOpen: false,
    });
  });

  it("找回 0 项时在对话框内显示失败文案", async () => {
    render(
      <StatusBar
        visibleCount={3}
          libraryCount={10}
        missingItems={missingItems}
        onRelocateMissing={async () => 0}
        onRemoveMissing={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /失效项目/ }));
    fireEvent.click(screen.getByRole("button", { name: /尝试找回全部失效项/ }));
    await waitFor(() => {
      expect(screen.getByText(/这次没有找回任何项目/)).toBeInTheDocument();
    });
  });

  it("找回成功时在对话框内显示已找回 N 项", async () => {
    render(
      <StatusBar
        visibleCount={3}
          libraryCount={10}
        missingItems={missingItems}
        onRelocateMissing={async () => 2}
        onRemoveMissing={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /失效项目/ }));
    fireEvent.click(screen.getByRole("button", { name: /尝试找回全部失效项/ }));
    await waitFor(() => {
      expect(screen.getByText("已找回 2 项")).toBeInTheDocument();
    });
  });

  it("找回失败时弹出错误 toast 并恢复按钮可用", async () => {
    const toasts: Array<{ message: string; type: string }> = [];
    const listener = (event: Event) => {
      toasts.push((event as CustomEvent<{ message: string; type: string }>).detail);
    };
    window.addEventListener("taglauncher-toast", listener);
    try {
      render(
        <StatusBar
          visibleCount={3}
              libraryCount={10}
          missingItems={missingItems}
          onRelocateMissing={async () => {
            throw new Error("磁盘不可读");
          }}
          onRemoveMissing={async () => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /失效项目/ }));
      const button = screen.getByRole("button", { name: /尝试找回全部失效项/ });
      fireEvent.click(button);
      await waitFor(() => {
        expect(toasts.some((t) => t.type === "error" && t.message.includes("磁盘不可读"))).toBe(true);
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /尝试找回全部失效项/ })).not.toBeDisabled();
      });
    } finally {
      window.removeEventListener("taglauncher-toast", listener);
    }
  });
});

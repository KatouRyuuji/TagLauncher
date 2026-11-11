// ============================================================================
// src/components/Sidebar.relations.spec.tsx — 侧栏「添加子标签」入口对准当前父标签
// ----------------------------------------------------------------------------
// 渲染真实 Sidebar：右键标签 → 编辑框「添加子标签…」→ 关系编辑器以该标签为当前
// 编辑对象、焦点在新建子标签输入框；层级按钮对准侧栏已选标签；新建写入
// (所选父, 新子)，而非默认第一个标签。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeProvider";
import { Sidebar } from "./Sidebar";
import { useAppStore } from "../stores/appStore";
import { THEME_FAMILIES } from "../themes";
import type { Tag } from "../types";

const mocks = vi.hoisted(() => ({
  getCurrentTheme: vi.fn(),
  getCustomThemes: vi.fn(),
  getThemeDirectoryInfo: vi.fn(),
  setCurrentTheme: vi.fn(),
  getCabinetItemCounts: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getCurrentTheme: mocks.getCurrentTheme,
  getCustomThemes: mocks.getCustomThemes,
  getThemeDirectoryInfo: mocks.getThemeDirectoryInfo,
  setCurrentTheme: mocks.setCurrentTheme,
  getCabinetItemCounts: mocks.getCabinetItemCounts,
  viewQuery: async () => ({ ids: [], browseDir: null, libraryTotal: 0 }),
  getItemsByIds: async () => [],
}));

// 「甲」按名称排在前面，是旧实现打开时默认对准的标签
const tags: Tag[] = [
  { id: 1, name: "甲", color: "#111111" },
  { id: 2, name: "游戏", color: "#222222" },
];

function renderSidebar() {
  const onAddTag = vi.fn(async (name: string, color: string): Promise<Tag> => ({ id: 9, name, color }));
  const onAddTagRelation = vi.fn(async () => {});
  render(
    <ThemeProvider>
      <Sidebar
        tags={tags}
        cabinets={[]}
        onAddTag={onAddTag}
        onUpdateTag={async () => {}}
        onRemoveTag={async () => {}}
        onAddCabinet={async () => 1}
        onUpdateCabinet={async () => {}}
        onRemoveCabinet={async () => {}}
        onAddTagToItem={async () => {}}
        onAddTagRelation={onAddTagRelation}
        onRemoveTagRelation={async () => {}}
        onMoveTagParent={async () => {}}
        stats={null}
        dataEpoch={0}
      />
    </ThemeProvider>,
  );
  return { onAddTag, onAddTagRelation };
}

function currentRow(dialog: HTMLElement) {
  return within(dialog).getAllByRole("button").find((b) => b.getAttribute("aria-current") === "true");
}

describe("侧栏添加子标签入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // jsdom 无布局，scrollIntoView 未实现；行为由真实浏览器负责，这里只需可调用
    Element.prototype.scrollIntoView = vi.fn();
    mocks.getCurrentTheme.mockResolvedValue(THEME_FAMILIES[0].light);
    mocks.getCustomThemes.mockResolvedValue({ themes: [], errors: [] });
    mocks.getThemeDirectoryInfo.mockResolvedValue({ path: "", exists: true });
    mocks.getCabinetItemCounts.mockResolvedValue([]);
    useAppStore.setState({ tagRelations: [], selectedTagIds: [], excludedTagIds: [], sidebarTab: "tags" });
  });

  it("右键父标签 → 添加子标签…：编辑器对准该标签并写入 (父, 新子)", async () => {
    const { onAddTag, onAddTagRelation } = renderSidebar();
    const row = await screen.findByRole("button", { name: /游戏/ });
    fireEvent.contextMenu(row);
    await userEvent.click(await screen.findByRole("button", { name: "添加子标签…" }));

    const dialog = await screen.findByRole("dialog", { name: "标签关系" });
    expect(screen.queryByRole("dialog", { name: "编辑标签" })).not.toBeInTheDocument();
    expect(currentRow(dialog)).toHaveTextContent("游戏");
    const input = within(dialog).getByRole("textbox", { name: "新建子标签" });
    await waitFor(() => expect(input).toHaveFocus());

    await userEvent.type(input, "卡牌");
    await userEvent.click(within(dialog).getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onAddTag).toHaveBeenCalledWith("卡牌", expect.any(String)));
    await waitFor(() => expect(onAddTagRelation).toHaveBeenCalledWith(2, 9));
  });

  it("层级按钮对准侧栏已选标签；未选时回退第一个", async () => {
    useAppStore.setState({ selectedTagIds: [2] });
    renderSidebar();
    await userEvent.click(await screen.findByRole("button", { name: "管理标签父子关系" }));
    const dialog = await screen.findByRole("dialog", { name: "标签关系" });
    expect(currentRow(dialog)).toHaveTextContent("游戏");
    await userEvent.click(within(dialog).getByRole("button", { name: "完成" }));

    useAppStore.setState({ selectedTagIds: [] });
    await userEvent.click(screen.getByRole("button", { name: "管理标签父子关系" }));
    const again = await screen.findByRole("dialog", { name: "标签关系" });
    expect(currentRow(again)).toHaveTextContent("甲");
  });

  it("编辑层级开关：显示拖动说明与「移出当前父级」落点，再按退出", async () => {
    useAppStore.setState({ tagRelations: [{ parentId: 2, childId: 1 }] });
    renderSidebar();
    const toggle = await screen.findByRole("button", { name: "编辑层级" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("tag-root-drop")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tag-hierarchy-hint")).toHaveTextContent("按住 Alt 放下");
    expect(screen.getByTestId("tag-root-drop")).toHaveTextContent("移出当前父级");
    // 行带路径上的父级，拖动据此决定「从哪个父级移出」（空库时父级默认折叠，先展开）
    await userEvent.click(screen.getByRole("button", { name: "展开 游戏的下级标签" }));
    expect(document.querySelector('[data-tag-row-id="1"]')).toHaveAttribute("data-tag-parent-id", "2");
    await userEvent.click(toggle);
    expect(screen.queryByTestId("tag-root-drop")).toBeNull();
  });
});

// ============================================================================
// TagFilterBar.spec.tsx — 顶栏标签右键反选（侧栏右键仍是编辑，不在本组件）
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TagFilterBar } from "./TagFilterBar";
import { useAppStore } from "../stores/appStore";

describe("TagFilterBar 右键反选", () => {
  beforeEach(() => {
    useAppStore.setState({
      tags: [{ id: 1, name: "设计", color: "#e11d48" }],
      selectedTagIds: [1],
      excludedTagIds: [],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
      workspaceFiltersOpen: true,
    });
  });

  it("没有已选或排除标签时不渲染全量芯片", () => {
    useAppStore.setState({ selectedTagIds: [], excludedTagIds: [] });
    render(<TagFilterBar />);
    expect(screen.queryByRole("group", { name: "已选标签" })).not.toBeInTheDocument();
  });

  it("右键标签进入反选态，再次右键取消", () => {
    render(<TagFilterBar />);
    const chip = screen.getByTitle("设计（右键排除含此标签的项目）");
    fireEvent.contextMenu(chip);
    expect(useAppStore.getState().excludedTagIds).toEqual([1]);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(screen.getByLabelText("设计（已排除）")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByLabelText("设计（已排除）"));
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });

  it("左键正选会撤销该标签的反选", () => {
    useAppStore.setState({ selectedTagIds: [], excludedTagIds: [1] });
    render(<TagFilterBar />);
    fireEvent.click(screen.getByLabelText("设计（已排除）"));
    expect(useAppStore.getState().selectedTagIds).toEqual([1]);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });
});

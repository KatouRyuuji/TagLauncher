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
      selectedTagIds: [],
      excludedTagIds: [],
      selectedCabinetId: null,
      showFavorites: false,
      showRecent: false,
    });
  });

  it("右键标签进入反选态，再次右键取消", () => {
    render(<TagFilterBar />);
    const chip = screen.getByTitle("设计（右键排除含此标签的对象）");
    fireEvent.contextMenu(chip);
    expect(useAppStore.getState().excludedTagIds).toEqual([1]);
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
    expect(screen.getByLabelText("设计（已排除）")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByLabelText("设计（已排除）"));
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });

  it("左键正选会撤销该标签的反选", () => {
    useAppStore.setState({ excludedTagIds: [1] });
    render(<TagFilterBar />);
    fireEvent.click(screen.getByLabelText("设计（已排除）"));
    expect(useAppStore.getState().selectedTagIds).toEqual([1]);
    expect(useAppStore.getState().excludedTagIds).toEqual([]);
  });
});

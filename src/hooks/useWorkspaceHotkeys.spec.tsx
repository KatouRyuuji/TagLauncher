// ============================================================================
// src/hooks/useWorkspaceHotkeys.spec.tsx — 工作台热键测试
// ============================================================================
// F3 / Ctrl+F 聚焦搜索（输入中也可用）；修饰键组合（Ctrl+Shift+F3 等）不触发。
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useWorkspaceHotkeys } from "./useWorkspaceHotkeys";
import { WORKSPACE_SEARCH_ID } from "../lib/workspaceChrome";

function setup() {
  const input = document.createElement("input");
  input.id = WORKSPACE_SEARCH_ID;
  document.body.appendChild(input);

  renderHook(() =>
    useWorkspaceHotkeys({
      blocked: false,
      items: [],
      allItems: [],
      selectedItemIds: [],
      setSelectedItemIds: () => {},
      onLaunch: () => {},
      onRemoveSelected: () => {},
      onToggleSelectedFavorite: () => {},
      onToggleItemFavorite: () => {},
      onOpenSettings: () => {},
    }),
  );
  return input;
}

describe("useWorkspaceHotkeys · 搜索聚焦", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("F3 聚焦全局搜索框", () => {
    const input = setup();
    fireEvent.keyDown(window, { key: "F3" });
    expect(document.activeElement).toBe(input);
  });

  it("输入框内按 F3 也聚焦搜索（不打断输入流之外的可用性）", () => {
    const input = setup();
    input.focus();
    fireEvent.keyDown(input, { key: "F3" });
    expect(document.activeElement).toBe(input);
  });

  it("Ctrl+F 聚焦搜索框", () => {
    const input = setup();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("带 Shift/Alt 的 F3 不触发", () => {
    const input = setup();
    fireEvent.keyDown(window, { key: "F3", shiftKey: true });
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(window, { key: "F3", altKey: true });
    expect(document.activeElement).not.toBe(input);
  });
});

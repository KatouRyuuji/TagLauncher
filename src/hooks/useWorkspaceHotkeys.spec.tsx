// ============================================================================
// src/hooks/useWorkspaceHotkeys.spec.tsx — 工作台热键测试
// ============================================================================
// F3 / Ctrl+F 聚焦搜索（输入中也可用）；修饰键组合（Ctrl+Shift+F3 等）不触发。
// 备注弹窗叠在快速预览之上时，预览的方向键 / Enter 让路给输入框。
// F2 对单个选中项打开重命名，失效对象只提示；多选时打开批量重命名。
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useWorkspaceHotkeys } from "./useWorkspaceHotkeys";
import { WORKSPACE_SEARCH_ID } from "../lib/workspaceChrome";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import { showToast } from "../lib/toast";

vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

function setup(options: { items?: ItemWithTags[]; selectedItemIds?: number[]; onLaunch?: (id: number) => void } = {}) {
  const input = document.createElement("input");
  input.id = WORKSPACE_SEARCH_ID;
  document.body.appendChild(input);

  renderHook(() =>
    useWorkspaceHotkeys({
      blocked: false,
      items: options.items ?? [],
      allItems: options.items ?? [],
      selectedItemIds: options.selectedItemIds ?? [],
      setSelectedItemIds: () => {},
      onLaunch: options.onLaunch ?? (() => {}),
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

function previewItem(id: number): ItemWithTags {
  return { id, name: `对象${id}`, path: `D:\\对象${id}.exe`, type: "exe", created_at: "2026-10-08 00:00:00", is_favorite: false, tags: [] };
}

describe("useWorkspaceHotkeys · 快速预览上的备注弹窗", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useAppStore.setState({ previewItemId: 1, noteEditorItemId: 1 });
  });

  it("备注弹窗打开时，方向键与 Enter 不切换预览、不启动对象", () => {
    const onLaunch = vi.fn();
    setup({ items: [previewItem(1), previewItem(2)], onLaunch });
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "ArrowRight" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(useAppStore.getState().previewItemId).toBe(1);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("备注弹窗关闭后，预览的 Enter 恢复启动对象", () => {
    const onLaunch = vi.fn();
    setup({ items: [previewItem(1), previewItem(2)], onLaunch });
    useAppStore.setState({ noteEditorItemId: null });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onLaunch).toHaveBeenCalledWith(1);
  });
});

describe("useWorkspaceHotkeys · F2 重命名", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(showToast).mockClear();
    useAppStore.setState({ previewItemId: null, noteEditorItemId: null, renameItemId: null, batchRenameOpen: false });
  });

  it("单个选中项按 F2 打开重命名", () => {
    setup({ items: [previewItem(1), previewItem(2)], selectedItemIds: [2] });
    fireEvent.keyDown(window, { key: "F2" });
    expect(useAppStore.getState().renameItemId).toBe(2);
  });

  it("多选按 F2 打开批量重命名", () => {
    setup({ items: [previewItem(1), previewItem(2)], selectedItemIds: [1, 2] });
    fireEvent.keyDown(window, { key: "F2" });
    expect(useAppStore.getState().batchRenameOpen).toBe(true);
    expect(useAppStore.getState().renameItemId).toBeNull();
  });

  it("输入中按 F2 不触发", () => {
    const input = setup({ items: [previewItem(1), previewItem(2)], selectedItemIds: [1, 2] });
    input.focus();
    fireEvent.keyDown(input, { key: "F2" });
    expect(useAppStore.getState().batchRenameOpen).toBe(false);
    expect(useAppStore.getState().renameItemId).toBeNull();
  });

  it("失效对象按 F2 只提示不打开", () => {
    setup({ items: [{ ...previewItem(1), is_missing: true }], selectedItemIds: [1] });
    fireEvent.keyDown(window, { key: "F2" });
    expect(useAppStore.getState().renameItemId).toBeNull();
    expect(showToast).toHaveBeenCalledWith("失效对象不能重命名", "warning");
  });
});

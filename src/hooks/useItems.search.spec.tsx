import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import { buildSearchIndex } from "../lib/search";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

vi.mock("../lib/db", () => ({ getItems: vi.fn(async () => fixtures), relocateMissing: vi.fn() }));
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn() }));
vi.mock("../lib/search", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/search")>();
  return { ...original, buildSearchIndex: vi.fn(original.buildSearchIndex) };
});

const fixtures: ItemWithTags[] = [
  { id: 1, name: "项目文档", path: "D:/项目文档", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
  { id: 2, name: "Visual Studio Code", path: "D:/Code.exe", type: "exe", created_at: "2026-01-01", is_favorite: true, tags: [] },
];

describe("对象搜索按需索引", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ searchQuery: "", searchMode: "all", selectedTagIds: [], excludedTagIds: [], selectedCabinetId: null, showFavorites: false, showRecent: false, typeFilter: "all", sortMode: "smart", tagRelations: [] });
  });

  it("并发找回共享结果，扫描错误保留为失败状态并允许重试", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let reject!: (error: Error) => void;
    vi.mocked(db.relocateMissing).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = result.current.relocateMissing();
    const second = result.current.relocateMissing();
    expect(first).toBe(second);
    const failure = expect(first).rejects.toThrow("扫描未完成");
    reject(new Error("扫描未完成"));
    await failure;
    expect(db.relocateMissing).toHaveBeenCalledTimes(1);
    vi.mocked(db.relocateMissing).mockResolvedValueOnce(0);
    await expect(result.current.relocateMissing()).resolves.toBe(0);
    expect(db.relocateMissing).toHaveBeenCalledTimes(2);
  });

  it("首屏、类型和标签筛选直接使用数据，无搜索词时不构建拼音索引", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((item) => item.id)).toEqual([2, 1]);
    act(() => useAppStore.setState({ selectedTagIds: [1], typeFilter: "folder" }));
    expect(result.current.items.map((item) => item.id)).toEqual([1]);
    expect(buildSearchIndex).not.toHaveBeenCalled();
  });

  it("首次搜索构建索引，继续输入复用索引，清空后恢复筛选和排序", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    expect(buildSearchIndex).toHaveBeenCalledTimes(1);
    act(() => useAppStore.setState({ searchQuery: "vsc" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([2]));
    expect(buildSearchIndex).toHaveBeenCalledTimes(1);
    act(() => useAppStore.setState({ searchQuery: "", typeFilter: "folder" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    expect(buildSearchIndex).toHaveBeenCalledTimes(1);
  });
});

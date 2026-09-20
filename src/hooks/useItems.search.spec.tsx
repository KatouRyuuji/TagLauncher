import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import { buildSearchIndex } from "../lib/search";
import { ensurePinyin } from "../lib/pinyinProvider";
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
  beforeAll(async () => {
    // 搜索/高亮链路经 pinyinProvider 懒加载：测试同步调用前确保模块就绪
    await ensurePinyin();
  });

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

  it("索引闲时预热只建一次；首屏、类型和标签筛选不触发新构建", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((item) => item.id)).toEqual([2, 1]);
    // loadAll 后的闲时预热（含 pinyin-pro 懒加载）只建一次索引
    await waitFor(() => expect(buildSearchIndex).toHaveBeenCalledTimes(1));
    act(() => useAppStore.setState({ selectedTagIds: [1], typeFilter: "folder" }));
    expect(result.current.items.map((item) => item.id)).toEqual([1]);
    expect(buildSearchIndex).toHaveBeenCalledTimes(1);
  });

  it("首次搜索仅一次索引调用（命中预热缓存），继续输入与清空不再新建", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    // 预热完成（1 次调用）
    await waitFor(() => expect(buildSearchIndex).toHaveBeenCalledTimes(1));
    // 首次搜索：memo 调用一次 buildSearchIndex，但内部命中预热缓存不做全量构建
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    expect(buildSearchIndex).toHaveBeenCalledTimes(2);
    // 继续输入：source 未变，memo 复用，零新调用
    act(() => useAppStore.setState({ searchQuery: "vsc" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([2]));
    expect(buildSearchIndex).toHaveBeenCalledTimes(2);
    act(() => useAppStore.setState({ searchQuery: "", typeFilter: "folder" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    expect(buildSearchIndex).toHaveBeenCalledTimes(2);
  });
});

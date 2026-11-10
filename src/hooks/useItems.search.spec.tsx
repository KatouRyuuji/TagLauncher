import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

// 后端 search_query 的替身：按「当前库」做名称子串 + 两个拼音缩写示例（打分语义由 Rust 对照测试覆盖），
// 但范围 / 类型 / 隐藏失效 / 顺序契约照后端实现：有范围按范围顺序，否则按库顺序。
const backend = vi.hoisted(() => ({ items: [] as ItemWithTags[] }));
const PINYIN: Record<string, string> = { xmwd: "项目文档", vsc: "Visual Studio Code" };
vi.mock("../lib/db", () => ({
  getItems: vi.fn(async () => {
    backend.items = fixtures;
    return fixtures;
  }),
  getCabinetItems: vi.fn(async () => []),
  relocateMissing: vi.fn(),
  searchWarm: vi.fn(async () => ({})),
  searchQuery: vi.fn(async (args: { query: string; scopeIds?: number[] | null; typeFilter?: string; hideMissing?: boolean }) => {
    const q = args.query.trim().toLowerCase();
    const byId = new Map(backend.items.map((it) => [it.id, it]));
    const base = args.scopeIds ? args.scopeIds.map((id) => byId.get(id)).filter((it): it is ItemWithTags => !!it) : backend.items;
    return base
      .filter((it) => (args.typeFilter && args.typeFilter !== "all" ? it.type === args.typeFilter : true))
      .filter((it) => !(args.hideMissing && it.is_missing))
      .filter((it) => it.name.toLowerCase().includes(q) || PINYIN[q] === it.name)
      .map((it) => it.id);
  }),
}));
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn() }));

function useLibrary(items: ItemWithTags[]) {
  vi.mocked(db.getItems).mockImplementationOnce(async () => {
    backend.items = items;
    return items;
  });
}

const fixtures: ItemWithTags[] = [
  { id: 1, name: "项目文档", path: "D:/项目文档", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
  { id: 2, name: "Visual Studio Code", path: "D:/Code.exe", type: "exe", created_at: "2026-01-01", is_favorite: true, tags: [] },
];

describe("对象搜索（后端索引）与筛选", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ searchQuery: "", searchMode: "all", selectedTagIds: [], excludedTagIds: [], selectedCabinetId: null, showFavorites: false, showRecent: false, typeFilter: "all", hideMissing: false, showNestedContents: false, libraryBrowseRoot: null, libraryBrowseDir: null, sortMode: "smart", tagRelations: [], tagFilterMode: "descendants" });
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

  it("首屏后预建后端索引；全部对象时不传范围，标签/类型筛选把范围 ID 交给后端", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((item) => item.id)).toEqual([2, 1]);
    await waitFor(() => expect(db.searchWarm).toHaveBeenCalledTimes(1));
    expect(db.searchQuery).not.toHaveBeenCalled();
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    expect(db.searchQuery).toHaveBeenLastCalledWith({ query: "xmwd", mode: "all", scopeIds: null, typeFilter: "all", hideMissing: false });
    act(() => useAppStore.setState({ searchQuery: "vsc", searchMode: "name" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([2]));
    expect(db.searchQuery).toHaveBeenLastCalledWith({ query: "vsc", mode: "name", scopeIds: null, typeFilter: "all", hideMissing: false });
    act(() => useAppStore.setState({ searchQuery: "项目", selectedTagIds: [1], typeFilter: "folder" }));
    await waitFor(() => expect(db.searchQuery).toHaveBeenLastCalledWith({ query: "项目", mode: "name", scopeIds: [1], typeFilter: "folder", hideMissing: false }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    act(() => useAppStore.setState({ searchQuery: "", selectedTagIds: [], typeFilter: "folder" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
  });

  it("新结果到达前沿用上一次结果；在途期间只保留最新查询，过期响应被丢弃", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    let releaseSlow!: (ids: number[]) => void;
    vi.mocked(db.searchQuery).mockImplementationOnce(() => new Promise((resolve) => { releaseSlow = resolve; }));
    act(() => useAppStore.setState({ searchQuery: "vs" }));
    expect(result.current.items.map((item) => item.id)).toEqual([1]);
    act(() => useAppStore.setState({ searchQuery: "vsc" }));
    // 在途的 "vs" 未返回前不再发新请求；"vsc" 排队，界面仍是上一次结果
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(db.searchQuery).mock.calls.map(([args]) => args.query)).toEqual(["xmwd", "vs"]);
    expect(result.current.items.map((item) => item.id)).toEqual([1]);
    // "vs" 返回后其结果作废，紧接着只发出 "vsc"
    await act(async () => releaseSlow([1, 2]));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([2]));
    expect(vi.mocked(db.searchQuery).mock.calls.map(([args]) => args.query)).toEqual(["xmwd", "vs", "vsc"]);
  });

  it("隐藏失效同时作用于浏览与搜索结果", async () => {
    const missing: ItemWithTags = { id: 3, name: "项目备份", path: "E:/项目备份", type: "folder", created_at: "2026-01-01", is_favorite: false, is_missing: true, tags: [] };
    useLibrary([...fixtures, missing]);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([2, 3, 1]));
    act(() => useAppStore.setState({ hideMissing: true }));
    expect(result.current.items.map((item) => item.id)).toEqual([2, 1]);
    act(() => useAppStore.setState({ searchQuery: "项目" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([1]));
    act(() => useAppStore.setState({ hideMissing: false }));
    await waitFor(() => expect(result.current.items.map((item) => item.id).sort()).toEqual([1, 3]));
  });

  it("All 默认隐藏目录内文件，搜索仍能命中，打开显示开关不丢内容", async () => {
    const nested: ItemWithTags[] = [
      { id: 10, name: "资料库", path: "D:\\Lib", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] },
      { id: 11, name: "隐藏笔记", path: "D:\\Lib\\notes.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
      { id: 12, name: "散文件", path: "D:\\loose.exe", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [] },
    ];
    useLibrary(nested);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.id).sort()).toEqual([10, 12]));
    act(() => useAppStore.setState({ searchQuery: "隐藏笔记" }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([11]));
    act(() => useAppStore.setState({ searchQuery: "", showNestedContents: true }));
    await waitFor(() => expect(result.current.items.map((item) => item.id).sort()).toEqual([10, 11, 12]));
    act(() => useAppStore.setState({ showNestedContents: false }));
    expect(result.current.items.map((item) => item.id).sort()).toEqual([10, 12]);
  });

  it("标签筛选与柜视图能看到 hide_from_all 对象，总览隐藏不是全局抹除", async () => {
    const nested: ItemWithTags[] = [
      { id: 10, name: "资料库", path: "D:\\Lib", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] },
      { id: 11, name: "隐藏笔记", path: "D:\\Lib\\notes.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
    ];
    useLibrary(nested);
    vi.mocked(db.getCabinetItems).mockResolvedValueOnce([nested[1]]);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([10]));
    act(() => useAppStore.setState({ selectedTagIds: [1] }));
    expect(result.current.items.map((item) => item.id)).toEqual([11]);
    act(() => useAppStore.setState({ selectedTagIds: [], selectedCabinetId: 3 }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([11]));
  });

  it("仅直接标签不并入后代对象", async () => {
    const nested: ItemWithTags[] = [
      { id: 1, name: "父对象", path: "D:\\a.exe", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 10, name: "A", color: "#111" }] },
      { id: 2, name: "子对象", path: "D:\\c.exe", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 12, name: "C", color: "#333" }] },
    ];
    useLibrary(nested);
    useAppStore.setState({ tagRelations: [{ parentId: 10, childId: 12 }], tagFilterMode: "descendants" });
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useAppStore.setState({ selectedTagIds: [10] }));
    expect(result.current.items.map((item) => item.id).sort()).toEqual([1, 2]);
    act(() => useAppStore.setState({ tagFilterMode: "direct" }));
    expect(result.current.items.map((item) => item.id)).toEqual([1]);
  });

  it("库内浏览只列出当前层，含被 All 隐藏的子文件", async () => {
    const nested: ItemWithTags[] = [
      { id: 10, name: "资料库", path: "D:\\Lib", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] },
      { id: 11, name: "隐藏笔记", path: "D:\\Lib\\notes.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
      { id: 12, name: "子目录", path: "D:\\Lib\\Sub", type: "folder", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
      { id: 13, name: "深层", path: "D:\\Lib\\Sub\\deep.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
    ];
    useLibrary(nested);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual([10]));
    act(() => useAppStore.setState({ libraryBrowseRoot: "D:\\Lib", libraryBrowseDir: null }));
    expect(result.current.items.map((item) => item.id).sort()).toEqual([11, 12]);
    act(() => useAppStore.setState({ libraryBrowseDir: "D:\\Lib\\Sub" }));
    expect(result.current.items.map((item) => item.id)).toEqual([13]);
  });

  it("contents 没有可见投放根时，按路径浏览仍能列出隐藏的中间目录和文件", async () => {
    const nested: ItemWithTags[] = [
      { id: 21, name: "Sub", path: "D:\\Lib\\Docs\\Sub", type: "folder", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
      { id: 22, name: "a.txt", path: "D:\\Lib\\Docs\\Sub\\a.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
      { id: 23, name: "b.txt", path: "D:\\Lib\\Docs\\b.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
    ];
    useLibrary(nested);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items).toEqual([]));
    act(() => useAppStore.setState({ libraryBrowseRoot: "D:\\Lib\\Docs", libraryBrowseDir: null }));
    expect(result.current.items.map((item) => item.id).sort()).toEqual([21, 23]);
    act(() => useAppStore.setState({ libraryBrowseDir: "D:\\Lib\\Docs\\Sub" }));
    expect(result.current.items.map((item) => item.id)).toEqual([22]);
  });
});

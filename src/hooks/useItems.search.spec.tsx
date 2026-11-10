import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

// 后端替身：view_query / library_stats / get_items_by_ids 走与演示后端同一套 TS 视图管线
// （Rust 实现与它逐例对照一致，见 src-tauri/src/view/corpus_tests.rs）。这里测的是 useItems
// 把工作台状态正确地交给后端、按视图结果分页取对象、在途只保留最新查询。
const fake = vi.hoisted(() => ({ items: [] as ItemWithTags[], cabinets: new Map<number, { members: number[]; folder: string | null }>() }));
vi.mock("../lib/db", async () => {
  const { fakeViewDb } = await import("../test/fakeViewBackend");
  return { ...fakeViewDb(fake), relocateMissing: vi.fn(), clearIconNoneMarkers: vi.fn(async () => {}) };
});
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn(), notifyCabinetItemsChanged: vi.fn(), notifyItemLaunched: vi.fn() }));

function useLibrary(items: ItemWithTags[]) {
  fake.items = items;
}

const ids = (result: { current: { view: { ids: readonly number[] } } }) => [...result.current.view.ids];
const queries = () => vi.mocked(db.viewQuery).mock.calls.map(([args]) => args.query);

const fixtures: ItemWithTags[] = [
  { id: 1, name: "项目文档", path: "D:/项目文档", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
  { id: 2, name: "Visual Studio Code", path: "D:/Code.exe", type: "exe", created_at: "2026-01-01", is_favorite: true, tags: [] },
];

describe("对象搜索（后端索引）与筛选", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.items = fixtures;
    fake.cabinets = new Map();
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

  it("浏览与搜索走同一个 view_query：工作台状态原样交给后端，标签按后代展开成组", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result)).toEqual([2, 1]);
    expect(db.viewQuery).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "all", query: "", sortMode: "smart", refreeze: true }));
    // 首屏只取可视页的对象：hook 本身不取（由列表按可视区间 ensureRange），按 ID 取的数据进缓存
    await act(async () => { await result.current.view.load([2]); });
    expect(result.current.view.get(2)?.name).toBe("Visual Studio Code");
    expect(result.current.view.get(1)).toBeUndefined();
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    expect(db.viewQuery).toHaveBeenLastCalledWith(expect.objectContaining({ query: "xmwd", mode: "all", selectedGroups: [], typeFilter: "all", hideMissing: false, refreeze: false }));
    act(() => useAppStore.setState({ searchQuery: "vsc", searchMode: "name" }));
    await waitFor(() => expect(ids(result)).toEqual([2]));
    useAppStore.setState({ tagRelations: [{ parentId: 1, childId: 7 }] });
    act(() => useAppStore.setState({ searchQuery: "项目", selectedTagIds: [1], typeFilter: "folder" }));
    await waitFor(() => expect(db.viewQuery).toHaveBeenLastCalledWith(expect.objectContaining({ query: "项目", mode: "name", selectedGroups: [[1, 7]], typeFilter: "folder" })));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    act(() => useAppStore.setState({ searchQuery: "", selectedTagIds: [], typeFilter: "folder" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
  });

  it("新结果到达前沿用上一次结果；在途期间只保留最新查询，过期响应被丢弃", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    let releaseSlow!: (value: { ids: number[]; browseDir: null; libraryTotal: number }) => void;
    vi.mocked(db.viewQuery).mockImplementationOnce(() => new Promise((resolve) => { releaseSlow = resolve; }));
    const before = queries().length;
    act(() => useAppStore.setState({ searchQuery: "vs" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    act(() => useAppStore.setState({ searchQuery: "vsc" }));
    // 在途的 "vs" 未返回前不再发新请求；"vsc" 排队，界面仍是上一次结果
    await new Promise((r) => setTimeout(r, 50));
    expect(queries().slice(before)).toEqual(["vs"]);
    expect(ids(result)).toEqual([1]);
    // "vs" 返回后其结果作废，紧接着只发出 "vsc"
    await act(async () => releaseSlow({ ids: [1, 2], browseDir: null, libraryTotal: 2 }));
    await waitFor(() => expect(ids(result)).toEqual([2]));
    expect(queries().slice(before)).toEqual(["vs", "vsc"]);
  });

  it("smart 排序冻结：只在排序/视图域切换或全量刷新时要求后端重拍", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const refreezes = () => vi.mocked(db.viewQuery).mock.calls.map(([args]) => args.refreeze);
    expect(refreezes()).toEqual([true]);
    act(() => useAppStore.setState({ searchQuery: "xmwd" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    act(() => useAppStore.setState({ searchQuery: "", sortMode: "name" }));
    await waitFor(() => expect(refreezes().at(-1)).toBe(true));
    const before = refreezes().length;
    await act(async () => { await result.current.refresh(); });
    expect(refreezes().slice(before)).toEqual([true]);
    // 搜索词变化本身不重拍（在途期间排队的那次可能仍带着未完成的重拍请求，重拍多一次无害）
    expect(vi.mocked(db.viewQuery).mock.calls.filter(([args]) => args.sortMode === "smart" && args.query === "xmwd").map(([args]) => args.refreeze)).toEqual([false]);
  });

  it("隐藏失效同时作用于浏览与搜索结果", async () => {
    const missing: ItemWithTags = { id: 3, name: "项目备份", path: "E:/项目备份", type: "folder", created_at: "2026-01-01", is_favorite: false, is_missing: true, tags: [] };
    useLibrary([...fixtures, missing]);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(ids(result)).toEqual([2, 3, 1]));
    act(() => useAppStore.setState({ hideMissing: true }));
    await waitFor(() => expect(ids(result)).toEqual([2, 1]));
    act(() => useAppStore.setState({ searchQuery: "项目" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
    act(() => useAppStore.setState({ hideMissing: false }));
    await waitFor(() => expect(ids(result).sort()).toEqual([1, 3]));
  });

  it("All 默认隐藏目录内文件，搜索仍能命中，打开显示开关不丢内容", async () => {
    const nested: ItemWithTags[] = [
      { id: 10, name: "资料库", path: "D:\\Lib", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] },
      { id: 11, name: "隐藏笔记", path: "D:\\Lib\\notes.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
      { id: 12, name: "散文件", path: "D:\\loose.exe", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [] },
    ];
    useLibrary(nested);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(ids(result).sort()).toEqual([10, 12]));
    act(() => useAppStore.setState({ searchQuery: "隐藏笔记" }));
    await waitFor(() => expect(ids(result)).toEqual([11]));
    act(() => useAppStore.setState({ searchQuery: "", showNestedContents: true }));
    await waitFor(() => expect(ids(result).sort()).toEqual([10, 11, 12]));
    act(() => useAppStore.setState({ showNestedContents: false }));
    await waitFor(() => expect(ids(result).sort()).toEqual([10, 12]));
  });

  it("标签筛选与柜视图能看到 hide_from_all 对象，总览隐藏不是全局抹除", async () => {
    const nested: ItemWithTags[] = [
      { id: 10, name: "资料库", path: "D:\\Lib", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] },
      { id: 11, name: "隐藏笔记", path: "D:\\Lib\\notes.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
    ];
    useLibrary(nested);
    fake.cabinets.set(3, { members: [11], folder: null });
    const { result } = renderHook(useItems);
    await waitFor(() => expect(ids(result)).toEqual([10]));
    act(() => useAppStore.setState({ selectedTagIds: [1] }));
    await waitFor(() => expect(ids(result)).toEqual([11]));
    act(() => useAppStore.setState({ selectedTagIds: [], selectedCabinetId: 3 }));
    await waitFor(() => expect(ids(result)).toEqual([11]));
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
    await waitFor(() => expect(ids(result).sort()).toEqual([1, 2]));
    act(() => useAppStore.setState({ tagFilterMode: "direct" }));
    await waitFor(() => expect(ids(result)).toEqual([1]));
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
    await waitFor(() => expect(ids(result)).toEqual([10]));
    act(() => useAppStore.setState({ libraryBrowseRoot: "D:\\Lib", libraryBrowseDir: null }));
    await waitFor(() => expect(ids(result).sort()).toEqual([11, 12]));
    act(() => useAppStore.setState({ libraryBrowseDir: "D:\\Lib\\Sub" }));
    await waitFor(() => expect(ids(result)).toEqual([13]));
  });

  it("contents 没有可见投放根时，按路径浏览仍能列出隐藏的中间目录和文件", async () => {
    const nested: ItemWithTags[] = [
      { id: 21, name: "Sub", path: "D:\\Lib\\Docs\\Sub", type: "folder", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
      { id: 22, name: "a.txt", path: "D:\\Lib\\Docs\\Sub\\a.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
      { id: 23, name: "b.txt", path: "D:\\Lib\\Docs\\b.txt", type: "text", created_at: "2026-01-01", is_favorite: false, hide_from_all: true, tags: [] },
    ];
    useLibrary(nested);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(ids(result)).toEqual([]));
    act(() => useAppStore.setState({ libraryBrowseRoot: "D:\\Lib\\Docs", libraryBrowseDir: null }));
    await waitFor(() => expect(ids(result).sort()).toEqual([21, 23]));
    act(() => useAppStore.setState({ libraryBrowseDir: "D:\\Lib\\Docs\\Sub" }));
    await waitFor(() => expect(ids(result)).toEqual([22]));
  });
});

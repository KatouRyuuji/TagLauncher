import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import { buildSearchIndex } from "../lib/search";
import { ensurePinyin } from "../lib/pinyinProvider";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

vi.mock("../lib/db", () => ({
  getItems: vi.fn(async () => fixtures),
  getCabinetItems: vi.fn(async () => []),
  relocateMissing: vi.fn(),
}));
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

  it("隐藏失效同时作用于浏览与搜索结果", async () => {
    const missing: ItemWithTags = { id: 3, name: "项目备份", path: "E:/项目备份", type: "folder", created_at: "2026-01-01", is_favorite: false, is_missing: true, tags: [] };
    vi.mocked(db.getItems).mockResolvedValueOnce([...fixtures, missing]);
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
    vi.mocked(db.getItems).mockResolvedValueOnce(nested);
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
    vi.mocked(db.getItems).mockResolvedValueOnce(nested);
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
    vi.mocked(db.getItems).mockResolvedValueOnce(nested);
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
    vi.mocked(db.getItems).mockResolvedValueOnce(nested);
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
    vi.mocked(db.getItems).mockResolvedValueOnce(nested);
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items).toEqual([]));
    act(() => useAppStore.setState({ libraryBrowseRoot: "D:\\Lib\\Docs", libraryBrowseDir: null }));
    expect(result.current.items.map((item) => item.id).sort()).toEqual([21, 23]);
    act(() => useAppStore.setState({ libraryBrowseDir: "D:\\Lib\\Docs\\Sub" }));
    expect(result.current.items.map((item) => item.id)).toEqual([22]);
  });
});

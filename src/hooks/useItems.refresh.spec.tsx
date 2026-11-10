import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITEM_REFRESH_EVENT, useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";
import { MAX_CACHED } from "../lib/itemView";

const before: ItemWithTags = { id: 1, name: "旧名称", path: "D:/旧名称", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] };
const after: ItemWithTags = { ...before, name: "新名称", path: "D:/新名称" };

const fake = vi.hoisted(() => ({ items: [] as ItemWithTags[], cabinets: new Map<number, { members: number[]; folder: string | null }>() }));
vi.mock("../lib/db", async () => {
  const { fakeViewDb } = await import("../test/fakeViewBackend");
  return {
    ...fakeViewDb(fake),
    getItem: vi.fn(async (id: number) => fake.items.find((it) => it.id === id)),
    relocateMissing: vi.fn(),
    clearIconNoneMarkers: vi.fn(async () => {}),
  };
});
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn(), notifyCabinetItemsChanged: vi.fn(), notifyItemLaunched: vi.fn() }));
const events = vi.hoisted(() => ({ handlers: new Map<string, Set<(e: { payload: unknown }) => void>>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (e: { payload: unknown }) => void) => {
    if (!events.handlers.has(name)) events.handlers.set(name, new Set());
    events.handlers.get(name)!.add(handler);
    return () => { events.handlers.get(name)!.delete(handler); };
  }),
}));
const emitEvent = (name: string, payload: unknown) => events.handlers.get(name)?.forEach((h) => h({ payload }));

// 列表按可视区间取页：模拟列表挂载后对首屏调用 ensureRange，读出可视对象名
type Hook = { current: ReturnType<typeof useItems> };
const visibleNames = (result: Hook) => {
  result.current.view.ensureRange(0, 50);
  return result.current.view.ids.map((id) => result.current.view.get(id)?.name);
};

describe("外部改名后的界面刷新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.items = [before];
    fake.cabinets = new Map([[7, { members: [1], folder: null }]]);
    useAppStore.setState({ searchQuery: "", searchMode: "all", selectedTagIds: [], excludedTagIds: [], selectedCabinetId: null, showFavorites: false, showRecent: false, typeFilter: "all", sortMode: "smart", tagRelations: [], hideMissing: false, showNestedContents: false, libraryBrowseRoot: null, libraryBrowseDir: null });
  });

  it("柜视图下全量刷新重查当前柜并重取可视页（旧数据先照常显示）", async () => {
    useAppStore.setState({ selectedCabinetId: 7 });
    const { result } = renderHook(useItems);
    await waitFor(() => expect(visibleNames(result)).toEqual(["旧名称"]));
    fake.items = [after];
    await act(async () => { await result.current.refresh(); });
    expect(db.viewQuery).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "cabinet", cabinetId: 7, refreeze: true }));
    // 缓存标成过期但不清空：重取前仍显示旧名，不闪空
    expect(result.current.view.get(1)?.name).toBe("旧名称");
    await waitFor(() => expect(visibleNames(result)).toEqual(["新名称"]));
  });

  it("单对象刷新事件按 id 重读并更新名称", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(visibleNames(result)).toEqual(["旧名称"]));
    fake.items = [after];
    act(() => { window.dispatchEvent(new CustomEvent(ITEM_REFRESH_EVENT, { detail: { id: 1 } })); });
    await waitFor(() => expect(result.current.view.get(1)?.name).toBe("新名称"));
    expect(db.getItem).toHaveBeenCalledWith(1);
  });

  it("在途加载期间再次刷新会排队跟进一次，拿到写库后的新数据", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = vi.mocked(db.viewQuery).getMockImplementation()!;
    vi.mocked(db.viewQuery).mockClear();
    vi.mocked(db.viewQuery).mockImplementationOnce(async (args) => { await gate; return real(args); });
    let first!: Promise<void>;
    let second!: Promise<void>;
    let third!: Promise<void>;
    act(() => {
      first = result.current.refresh();
    });
    // 第一次查询在途时写库并再刷新两次：只排队跟进一次（latestOnly），拿到写库后的数据
    await waitFor(() => expect(db.viewQuery).toHaveBeenCalledTimes(1));
    fake.items = [after, { ...after, id: 2, name: "新对象", path: "D:/新对象" }];
    act(() => {
      second = result.current.refresh();
      third = result.current.refresh();
    });
    await act(async () => { release(); await Promise.all([first, second, third]); });
    await waitFor(() => expect(visibleNames(result)).toEqual(["新对象", "新名称"]));
    expect(db.viewQuery).toHaveBeenCalledTimes(2);
  });

  it("外部进程写库（data-changed origin=external）自动重载；本应用写入不重载", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(visibleNames(result)).toEqual(["旧名称"]));
    await waitFor(() => expect(events.handlers.get("data-changed")?.size ?? 0).toBeGreaterThan(0));
    vi.mocked(db.viewQuery).mockClear();
    fake.items = [after];
    act(() => { emitEvent("data-changed", { origin: "app", seq: 1, detectedAtMs: 1 }); });
    await new Promise((r) => setTimeout(r, 80));
    expect(db.viewQuery).not.toHaveBeenCalled();
    act(() => { emitEvent("data-changed", { origin: "external", seq: 2, detectedAtMs: 2 }); });
    await waitFor(() => expect(visibleNames(result)).toEqual(["新名称"]));
    expect(db.viewQuery).toHaveBeenCalledTimes(1);
  });

  it("缓存有上限：滚过大列表后只保留最近用到的页，回滚时按需重取", async () => {
    const n = MAX_CACHED + 1000;
    fake.items = Array.from({ length: n }, (_, i) => ({ ...before, id: i + 1, name: `对象${i + 1}`, path: `D:/o${i + 1}` }));
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.view.ids.length).toBe(n));
    for (let start = 0; start < n; start += 50) {
      await act(async () => { result.current.view.ensureRange(start, start + 50); await Promise.resolve(); });
    }
    await waitFor(() => expect(result.current.view.get(n)).toBeDefined());
    expect(result.current.view.get(1)).toBeUndefined();
    const calls = vi.mocked(db.getItemsPage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([ids]) => ids.length <= 50)).toBe(true);
    await act(async () => { result.current.view.ensureRange(0, 50); await Promise.resolve(); });
    await waitFor(() => expect(result.current.view.get(1)?.name).toBe("对象1"));
  });

  it("全盘找回在途时，限定文件夹的找回独立执行（不被全盘扫描吞掉）；重复全盘请求复用在途扫描", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let releaseFull!: (n: number) => void;
    vi.mocked(db.relocateMissing).mockImplementationOnce(() => new Promise((resolve) => { releaseFull = resolve; }));
    vi.mocked(db.relocateMissing).mockResolvedValueOnce(0);
    let full!: Promise<number>;
    let fullAgain!: Promise<number>;
    let scoped!: Promise<number>;
    act(() => {
      full = result.current.relocateMissing();
      fullAgain = result.current.relocateMissing();
      scoped = result.current.relocateMissing(["D:\\Games"]);
    });
    await act(async () => { await scoped; });
    expect(db.relocateMissing).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.relocateMissing).mock.calls[0]).toEqual([undefined]);
    expect(vi.mocked(db.relocateMissing).mock.calls[1]).toEqual([["D:\\Games"]]);
    expect(fullAgain).toBe(full);
    await act(async () => { releaseFull(0); await full; });
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITEM_REFRESH_EVENT, useItems } from "./useItems";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

const before: ItemWithTags = { id: 1, name: "旧名称", path: "D:/旧名称", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] };
const after: ItemWithTags = { ...before, name: "新名称", path: "D:/新名称" };

vi.mock("../lib/db", () => ({
  getItems: vi.fn(async () => [before]),
  getCabinetItems: vi.fn(async () => [before]),
  getItem: vi.fn(async () => after),
  relocateMissing: vi.fn(),
  clearIconNoneMarkers: vi.fn(async () => {}),
  searchWarm: vi.fn(async () => ({})),
}));
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn() }));
const events = vi.hoisted(() => ({ handlers: new Map<string, Set<(e: { payload: unknown }) => void>>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (e: { payload: unknown }) => void) => {
    if (!events.handlers.has(name)) events.handlers.set(name, new Set());
    events.handlers.get(name)!.add(handler);
    return () => { events.handlers.get(name)!.delete(handler); };
  }),
}));
const emitEvent = (name: string, payload: unknown) => events.handlers.get(name)?.forEach((h) => h({ payload }));

describe("外部改名后的界面刷新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getItems).mockResolvedValue([before]);
    vi.mocked(db.getCabinetItems).mockResolvedValue([before]);
    useAppStore.setState({ searchQuery: "", searchMode: "all", selectedTagIds: [], excludedTagIds: [], selectedCabinetId: null, showFavorites: false, showRecent: false, typeFilter: "all", sortMode: "smart", tagRelations: [] });
  });

  it("柜视图下全量刷新会重取当前柜内容", async () => {
    useAppStore.setState({ selectedCabinetId: 7 });
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["旧名称"]));
    vi.mocked(db.getItems).mockResolvedValue([after]);
    vi.mocked(db.getCabinetItems).mockResolvedValue([after]);
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["新名称"]));
    expect(db.getCabinetItems).toHaveBeenLastCalledWith(7, false);
  });

  it("非柜视图的全量刷新不重取柜内容", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refresh(); });
    expect(db.getCabinetItems).not.toHaveBeenCalled();
  });

  it("单对象刷新事件按 id 重读并更新名称", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["旧名称"]));
    act(() => { window.dispatchEvent(new CustomEvent(ITEM_REFRESH_EVENT, { detail: { id: 1 } })); });
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["新名称"]));
    expect(db.getItem).toHaveBeenCalledWith(1);
  });

  it("在途加载期间再次刷新会排队跟进一次，拿到写库后的新数据", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let release!: (items: ItemWithTags[]) => void;
    vi.mocked(db.getItems).mockClear();
    vi.mocked(db.getItems).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    vi.mocked(db.getItems).mockResolvedValue([after]);
    let first!: Promise<void>;
    let second!: Promise<void>;
    let third!: Promise<void>;
    act(() => {
      first = result.current.refresh();
      second = result.current.refresh();
      third = result.current.refresh();
    });
    await act(async () => { release([before]); await Promise.all([first, second, third]); });
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["新名称"]));
    expect(db.getItems).toHaveBeenCalledTimes(2);
  });

  it("外部进程写库（data-changed origin=external）自动重载；本应用写入不重载", async () => {
    const { result } = renderHook(useItems);
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["旧名称"]));
    await waitFor(() => expect(events.handlers.get("data-changed")?.size ?? 0).toBeGreaterThan(0));
    vi.mocked(db.getItems).mockClear();
    vi.mocked(db.getItems).mockResolvedValue([after]);
    act(() => { emitEvent("data-changed", { origin: "app", seq: 1, detectedAtMs: 1 }); });
    await new Promise((r) => setTimeout(r, 80));
    expect(db.getItems).not.toHaveBeenCalled();
    act(() => { emitEvent("data-changed", { origin: "external", seq: 2, detectedAtMs: 2 }); });
    await waitFor(() => expect(result.current.items.map((item) => item.name)).toEqual(["新名称"]));
    expect(db.getItems).toHaveBeenCalledTimes(1);
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

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
}));
vi.mock("../lib/modApi", () => ({ notifyItemsChanged: vi.fn() }));

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
});

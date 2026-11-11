import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemWithTags } from "../types";
import type { PinViewState } from "../lib/desktopShortcut";
import * as db from "../lib/db";

const bus = vi.hoisted(() => ({ handlers: new Map<string, Set<(e: { payload: unknown }) => void>>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (e: { payload: unknown }) => void) => {
    if (!bus.handlers.has(name)) bus.handlers.set(name, new Set());
    bus.handlers.get(name)!.add(handler);
    return () => bus.handlers.get(name)!.delete(handler);
  }),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

const data = vi.hoisted(() => ({ title: "资料 / 项目" as string | null, items: [] as ItemWithTags[], total: 0 }));
vi.mock("../lib/db", () => ({
  pinItems: vi.fn(async () => ({ source: { kind: "cabinet", id: 1 }, title: data.title, total: data.total, items: data.items })),
  pinExpand: vi.fn(async () => true),
  pinCollapse: vi.fn(async () => true),
  pinHandleColor: vi.fn(async () => {}),
  launchItem: vi.fn(async () => {}),
  openInExplorerById: vi.fn(async () => {}),
  getItemVisual: vi.fn(async () => ({ path: "", icon_path: null })),
}));

const { PinView } = await import("./PinView");
const { filterPinItems, pinCountText, PIN_LEAVE_COLLAPSE_MS } = await import("./pinModel");

const item = (id: number, name: string, extra: Partial<ItemWithTags> = {}): ItemWithTags => ({
  id, name, path: `D:/pin/${name}`, type: "file", created_at: "2026-11-11", is_favorite: false, tags: [], ...extra,
});

function view(patch: Partial<PinViewState["settings"]> = {}, drawer: PinViewState["drawer"] = "collapsed"): PinViewState {
  return { surface: "pin", settings: { enabled: true, source: { kind: "cabinet", id: 1 }, mode: "float", edge: "right", topmost: true, ...patch }, drawer };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  bus.handlers.clear();
  data.title = "资料 / 项目";
  data.items = [item(1, "报告.docx", { tags: [{ id: 5, name: "工作", color: "#000" }] }), item(2, "截图.png")];
  data.total = 2;
});

describe("pinModel", () => {
  it("筛选匹配名称 / 路径 / 标签名，不分大小写；页脚文字", () => {
    const items = [item(1, "Report.docx"), item(2, "a.png", { tags: [{ id: 1, name: "工作", color: "#000" }] })];
    expect(filterPinItems(items, "report").map((i) => i.id)).toEqual([1]);
    expect(filterPinItems(items, "工作").map((i) => i.id)).toEqual([2]);
    expect(filterPinItems(items, "  ")).toBe(items);
    expect(pinCountText(3, 3, 3, "")).toBe("共 3 项");
    expect(pinCountText(800, 500, 500, "")).toContain("显示前 500 项");
    expect(pinCountText(800, 500, 2, "x")).toBe("匹配 2 项");
  });
});

describe("PinView", () => {
  it("浮动窗：标题、数量、双击打开；数据变化事件触发重取", async () => {
    render(<PinView view={view()} />);
    await waitFor(() => expect(screen.getByTestId("pin-title")).toHaveTextContent("资料 / 项目"));
    expect(screen.getByTestId("pin-count")).toHaveTextContent("2");
    expect(screen.getByTestId("pin-header")).toHaveAttribute("data-tauri-drag-region");
    fireEvent.doubleClick(screen.getAllByTestId("pin-item")[0]);
    await waitFor(() => expect(db.launchItem).toHaveBeenCalledWith(1));
    expect(db.pinCollapse).not.toHaveBeenCalled();
    data.items = [...data.items, item(3, "新增.txt")];
    data.total = 3;
    act(() => { bus.handlers.get("data-changed")?.forEach((h) => h({ payload: { origin: "external", seq: 1, detectedAtMs: 0 } })); });
    await waitFor(() => expect(screen.getAllByTestId("pin-item")).toHaveLength(3), { timeout: 2000 });
  });

  it("筛选框 ↑↓ Enter 打开；Ctrl+Enter 显示位置", async () => {
    const user = userEvent.setup();
    render(<PinView view={view()} />);
    await waitFor(() => expect(screen.getAllByTestId("pin-item")).toHaveLength(2));
    const input = screen.getByTestId("pin-filter");
    await user.click(input);
    await user.type(input, "截图");
    expect(screen.getAllByTestId("pin-item").map((el) => el.dataset.itemId)).toEqual(["2"]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(db.launchItem).toHaveBeenCalledWith(2));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(db.openInExplorerById).toHaveBeenCalledWith(2));
  });

  it("来源已删除时提示去设置", async () => {
    data.title = null;
    data.items = [];
    render(<PinView view={view()} />);
    expect(await screen.findByTestId("pin-missing")).toHaveTextContent("已被删除");
  });

  it("抽屉收起时面板已渲染（窗口由后端隐藏、原生把手负责悬停）、把手取主题色；展开后离开面板收回", async () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--accent", "#c0647d");
    const { rerender } = render(<PinView view={view({ mode: "drawer" })} />);
    expect(screen.getByTestId("pin-panel")).toHaveAttribute("data-mode", "drawer");
    expect(screen.queryByTestId("pin-handle")).toBeNull();
    expect(db.pinHandleColor).toHaveBeenCalledWith("#c0647d");
    // 收起状态下离开不触发收回
    fireEvent.mouseLeave(document.documentElement);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(db.pinCollapse).not.toHaveBeenCalled();

    rerender(<PinView view={view({ mode: "drawer" }, "expanded")} />);
    expect(screen.getByTestId("pin-panel")).toHaveAttribute("data-mode", "drawer");
    fireEvent.mouseLeave(document.documentElement);
    act(() => { vi.advanceTimersByTime(PIN_LEAVE_COLLAPSE_MS - 50); });
    fireEvent.mouseEnter(document.documentElement);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(db.pinCollapse).not.toHaveBeenCalled();
    fireEvent.mouseLeave(document.documentElement);
    act(() => { vi.advanceTimersByTime(PIN_LEAVE_COLLAPSE_MS + 5); });
    expect(db.pinCollapse).toHaveBeenCalledTimes(1);
  });
});

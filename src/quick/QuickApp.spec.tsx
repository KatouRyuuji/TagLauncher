import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

const bus = vi.hoisted(() => ({
  handlers: new Map<string, Set<(e: { payload: unknown }) => void>>(),
  emitted: [] as Array<{ name: string; payload: unknown }>,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (e: { payload: unknown }) => void) => {
    if (!bus.handlers.has(name)) bus.handlers.set(name, new Set());
    bus.handlers.get(name)!.add(handler);
    return () => bus.handlers.get(name)!.delete(handler);
  }),
  emit: vi.fn(async (name: string, payload: unknown) => { bus.emitted.push({ name, payload }); }),
}));

const fixtures: ItemWithTags[] = [
  { id: 1, name: "项目文档", path: "D:/项目文档", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
  { id: 2, name: "Visual Studio Code", path: "D:/Code.exe", type: "exe", created_at: "2026-01-01", is_favorite: true, tags: [] },
];

vi.mock("../lib/db", () => ({
  quickGetItems: vi.fn(async () => fixtures),
  quickHide: vi.fn(async () => {}),
  quickLocateInMain: vi.fn(async () => {}),
  launchItem: vi.fn(async () => {}),
  openInExplorerById: vi.fn(async () => {}),
  getTags: vi.fn(async () => [{ id: 1, name: "工作", color: "#5064d8" }, { id: 2, name: "工具", color: "#999" }]),
  setItemTags: vi.fn(async () => {}),
}));

const { QuickApp, QUICK_SHOWN_EVENT } = await import("./QuickApp");

function fire(name: string, payload: unknown) {
  act(() => { bus.handlers.get(name)?.forEach((h) => h({ payload })); });
}

async function setup() {
  const user = userEvent.setup();
  render(<QuickApp />);
  const input = screen.getByTestId("quick-input");
  await waitFor(() => expect(screen.getAllByTestId("quick-result")).toHaveLength(2));
  return { user, input };
}

beforeEach(() => {
  vi.clearAllMocks();
  bus.handlers.clear();
  bus.emitted = [];
  localStorage.clear();
});

describe("QuickApp", () => {
  it("输入即搜索（拼音缩写），Enter 打开、广播写入并收起", async () => {
    const { user, input } = await setup();
    await user.type(input, "xmwd");
    expect(screen.getAllByTestId("quick-result").map((el) => el.dataset.itemId)).toEqual(["1"]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(db.quickHide).toHaveBeenCalled());
    expect(db.launchItem).toHaveBeenCalledWith(1);
    expect(bus.emitted).toContainEqual({ name: "window-data-written", payload: { source: "quick", itemIds: [1], tagsChanged: false } });
    const perf = (window as unknown as { __tlQuickPerf: { queries: Array<{ q: string }> } }).__tlQuickPerf;
    await waitFor(() => expect(perf.queries.map((q) => q.q)).toContain("xmwd"));
  });

  it("Esc 先清空输入，再按才收起", async () => {
    const { user, input } = await setup();
    await user.type(input, "vsc");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(db.quickHide).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(db.quickHide).toHaveBeenCalledTimes(1);
  });

  it("↓ 选第二项后 Ctrl+Enter 显示位置、Alt+Enter 在主窗定位", async () => {
    const { user, input } = await setup();
    input.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(db.openInExplorerById).toHaveBeenCalledWith(1));
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await waitFor(() => expect(db.quickLocateInMain).toHaveBeenCalledWith(1));
  });

  it("Ctrl+T 打开标签选择器，Enter 切换标签并广播，Esc 返回结果", async () => {
    const { user, input } = await setup();
    await user.type(input, "xmwd");
    await user.keyboard("{Control>}t{/Control}");
    await screen.findByTestId("quick-tag-picker");
    await user.keyboard("工具");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(db.setItemTags).toHaveBeenCalledWith(1, [1, 2]));
    expect(await screen.findByTestId("quick-status")).toHaveTextContent("已添加标签「工具」");
    expect(bus.emitted).toContainEqual({ name: "window-data-written", payload: { source: "quick", itemIds: [1], tagsChanged: false } });
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("quick-tag-picker")).toBeNull();
    expect(screen.getByTestId("quick-input")).toHaveFocus();
  });

  it("唤出事件：聚焦输入框并记录唤出耗时；任何来源的写入都重新加载", async () => {
    await setup();
    (document.activeElement as HTMLElement | null)?.blur();
    fire(QUICK_SHOWN_EVENT, { t0Ms: Date.now() - 5 });
    expect(screen.getByTestId("quick-input")).toHaveFocus();
    const perf = (window as unknown as { __tlQuickPerf: { summons: Array<{ ms: number; focused: boolean }> } }).__tlQuickPerf;
    await waitFor(() => expect(perf.summons.length).toBeGreaterThan(0));
    expect(perf.summons.at(-1)!.focused).toBe(true);
    expect(db.quickGetItems).toHaveBeenCalledTimes(1);
    fire("data-changed", { origin: "app", seq: 1, detectedAtMs: 1 });
    await waitFor(() => expect(db.quickGetItems).toHaveBeenCalledTimes(2));
  });

  it("跟随主窗主题快照", async () => {
    localStorage.setItem("taglauncher.theme_snapshot", JSON.stringify({ vars: { "--bg-app": "#123456" }, attrs: { "data-scheme": "dark" } }));
    await setup();
    expect(document.documentElement.style.getPropertyValue("--bg-app")).toBe("#123456");
    expect(document.documentElement.getAttribute("data-scheme")).toBe("dark");
  });
});

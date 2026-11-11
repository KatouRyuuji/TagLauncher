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

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

const drop = vi.hoisted(() => ({ handler: null as null | ((e: { payload: unknown }) => void) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (h: (e: { payload: unknown }) => void) => {
      drop.handler = h;
      return () => { drop.handler = null; };
    }),
  }),
}));

const fixtures: ItemWithTags[] = [
  { id: 1, name: "项目文档", path: "D:/项目文档", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [{ id: 1, name: "工作", color: "#5064d8" }] },
  { id: 2, name: "Visual Studio Code", path: "D:/Code.exe", type: "exe", created_at: "2026-01-01", is_favorite: true, tags: [] },
];

// 后端 quick_search 的替身：只区分空查询与示例里用到的两个词（打分语义由 Rust 对照测试覆盖）
const BACKEND_HITS: Record<string, number[]> = { "": [2, 1], xmwd: [1], vsc: [2], many: Array.from({ length: 25 }, (_, i) => 100 + i) };
const manyItems: ItemWithTags[] = [];
for (let i = 0; i < 25; i++) {
  manyItems.push({ id: 100 + i, name: `批量 ${i}`, path: `D:/many/${i}.exe`, type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [] });
}
vi.mock("../lib/db", () => ({
  quickSearch: vi.fn(async ({ query }: { query: string }) => {
    const ids = BACKEND_HITS[query.trim()] ?? [];
    return { total: ids.length, indexed: fixtures.length, items: ids.map((id) => [...fixtures, ...manyItems].find((it) => it.id === id)!) };
  }),
  quickHide: vi.fn(async () => {}),
  pinState: vi.fn(async () => pinStub.view),
  pinItems: vi.fn(async () => ({ source: { kind: "cabinet", id: 10 }, title: "项目", total: 1, items: [fixtures[0]] })),
  pinExpand: vi.fn(async () => true),
  pinCollapse: vi.fn(async () => true),
  getItemVisual: vi.fn(async (id: number) => {
    const it = [...fixtures, ...manyItems].find((x) => x.id === id)!;
    return { path: it.path, icon_path: it.type === "exe" ? `C:/icons/${id}.png` : null };
  }),
  quickLocateInMain: vi.fn(async () => {}),
  launchItem: vi.fn(async () => {}),
  openInExplorerById: vi.fn(async () => {}),
  getTags: vi.fn(async () => [{ id: 1, name: "工作", color: "#5064d8" }, { id: 2, name: "工具", color: "#999" }]),
  setItemTags: vi.fn(async () => {}),
  collectSession: vi.fn(async () => collect.pending),
  clipboardCollectCandidates: vi.fn(async () => collect.clipboard),
  collectSubmit: vi.fn(async (paths: string[]) => {
    if (collect.submitError) throw new Error(collect.submitError);
    return { id: 9, paths, invocations: 1, invalid: 0, truncated: false, startedMs: 0 };
  }),
  collectFinish: vi.fn(async () => {}),
  getCollectPreference: vi.fn(async () => collect.pref),
  setCollectPreference: vi.fn(async (pref: unknown) => { collect.pref = pref; return pref; }),
  getCabinets: vi.fn(async () => [{ id: 10, name: "项目", color: "#123", folder_path: null }, { id: 11, name: "关联", color: "#456", folder_path: "D:/Linked" }]),
  classifyImportPaths: vi.fn(async (paths: string[]) => ({ files: paths.filter((p) => !p.endsWith("Dir")), folders: paths.filter((p) => p.endsWith("Dir")) })),
  expandFolderImport: vi.fn(async () => ({ paths: ["D:\\Dir\\sub\\in.txt"], truncated: false })),
  addItems: vi.fn(async (paths: string[]) => ({
    items: paths.map((path, i) => ({ id: 100 + i, path })),
    failed: [],
    createdCount: paths.length - 1,
  })),
}));

const pinStub = vi.hoisted(() => ({
  view: { surface: "search", settings: { enabled: false, source: null, mode: "float", edge: "right", topmost: true }, drawer: "collapsed" } as unknown,
}));
const collect = vi.hoisted(() => ({ pending: null as unknown, pref: null as unknown, clipboard: [] as string[], submitError: null as string | null }));

const { QuickApp, QUICK_SHOWN_EVENT, QUICK_MEMORY_EVENT } = await import("./QuickApp");

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
  collect.pending = null;
  collect.pref = null;
  collect.clipboard = [];
  collect.submitError = null;
  delete document.documentElement.dataset.surface;
  pinStub.view = { surface: "search", settings: { enabled: false, source: null, mode: "float", edge: "right", topmost: true }, drawer: "collapsed" };
});

describe("QuickApp", () => {
  it("输入即向后端取前 50 条，Enter 打开、广播写入并收起", async () => {
    const { user, input } = await setup();
    await user.type(input, "xmwd");
    await waitFor(() => expect(screen.getAllByTestId("quick-result").map((el) => el.dataset.itemId)).toEqual(["1"]));
    expect(db.quickSearch).toHaveBeenLastCalledWith({ query: "xmwd", mode: "all", hideMissing: false, limit: 50 });
    expect(input).toHaveAttribute("placeholder", "搜索 2 个对象…");
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
    await waitFor(() => expect(screen.getAllByTestId("quick-result")).toHaveLength(1));
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
    expect(db.quickSearch).toHaveBeenCalledTimes(1);
    expect(db.quickSearch).toHaveBeenLastCalledWith({ query: "", mode: "all", hideMissing: false, limit: 50 });
    fire("data-changed", { origin: "app", seq: 1, detectedAtMs: 1 });
    await waitFor(() => expect(db.quickSearch).toHaveBeenCalledTimes(2));
  });

  it("唤出事件带 keepInput=false 时清空上次输入，默认保留并全选", async () => {
    const user = userEvent.setup();
    await setup();
    const input = screen.getByTestId("quick-input") as HTMLInputElement;
    await user.type(input, "rep");
    fire(QUICK_SHOWN_EVENT, { t0Ms: Date.now(), keepInput: true });
    expect(input.value).toBe("rep");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    fire(QUICK_SHOWN_EVENT, { t0Ms: Date.now(), keepInput: false });
    await waitFor(() => expect(input.value).toBe(""));
    expect(input).toHaveFocus();
  });

  it("记录后端切换 WebView2 内存目标的事件（隐藏久了 low、唤出 normal）", async () => {
    await setup();
    await waitFor(() => expect(bus.handlers.get(QUICK_MEMORY_EVENT)?.size ?? 0).toBeGreaterThan(0));
    fire(QUICK_MEMORY_EVENT, { level: "low", atMs: 10 });
    fire(QUICK_MEMORY_EVENT, { level: "normal", atMs: 20 });
    const perf = (window as unknown as { __tlQuickPerf: { memory: Array<{ level: string; atMs: number }> } }).__tlQuickPerf;
    expect(perf.memory.slice(-2)).toEqual([{ level: "low", atMs: 10 }, { level: "normal", atMs: 20 }]);
  });

  it("结果只给前 20 条取图标（缩略图/程序图标），其余只画类型图标", async () => {
    const { user, input } = await setup();
    await waitFor(() => expect(screen.getAllByTestId("quick-result-icon")[0].querySelector("img")).not.toBeNull());
    expect(screen.getAllByTestId("quick-result-icon")[0].querySelector("img")!.getAttribute("src")).toBe("asset://C:/icons/2.png");
    await user.type(input, "many");
    await waitFor(() => expect(screen.getAllByTestId("quick-result")).toHaveLength(25));
    const kinds = screen.getAllByTestId("quick-result-icon").map((el) => el.dataset.visual);
    expect(kinds.filter((k) => k === "visual")).toHaveLength(20);
    expect(kinds.slice(20)).toEqual(["type", "type", "type", "type", "type"]);
    await waitFor(() => expect(screen.getAllByTestId("quick-result-icon")[19].querySelector("img")).not.toBeNull());
    const requested = new Set(vi.mocked(db.getItemVisual).mock.calls.map(([id]) => id));
    for (let i = 20; i < 25; i++) expect(requested.has(100 + i)).toBe(false);
  });

  it("跟随主窗主题快照", async () => {
    localStorage.setItem("taglauncher.theme_snapshot", JSON.stringify({ vars: { "--bg-app": "#123456" }, attrs: { "data-scheme": "dark" } }));
    await setup();
    expect(document.documentElement.style.getPropertyValue("--bg-app")).toBe("#123456");
    expect(document.documentElement.getAttribute("data-scheme")).toBe("dark");
  });
});

describe("QuickApp 收纳模式", () => {
  const session = (over: Record<string, unknown> = {}) => ({ id: 7, paths: ["D:/a.txt", "D:/b.txt"], invocations: 2, invalid: 0, truncated: false, startedMs: 0, ...over });

  it("挂载时取到会话就显示收纳界面；打标签多选后一次写入并记住选择", async () => {
    collect.pending = session();
    const user = userEvent.setup();
    render(<QuickApp />);
    const summary = await screen.findByTestId("collect-summary");
    expect(summary).toHaveAttribute("data-count", "2");
    expect(summary).toHaveTextContent("合并了 2 次右键调用");
    expect(screen.queryByTestId("quick-input")).toBeNull();
    await user.click(screen.getByTestId("collect-remember"));
    await user.click(screen.getByTestId("collect-action-tag"));
    const options = await screen.findAllByTestId("collect-tag-option");
    await user.click(options[0]);
    await user.click(options[1]);
    await user.click(screen.getByTestId("collect-confirm"));
    await waitFor(() => expect(db.addItems).toHaveBeenCalledWith(["D:/a.txt", "D:/b.txt"], { tagIds: [1, 2] }));
    const result = await screen.findByTestId("collect-result");
    expect(result).toHaveAttribute("data-created", "1");
    expect(result).toHaveAttribute("data-existing", "1");
    expect(result).toHaveTextContent("已打标签「工作、工具」");
    expect(db.setCollectPreference).toHaveBeenCalledWith({ action: "tag", tagIds: [1, 2], cabinetId: null, folderMode: null });
    expect(bus.emitted).toContainEqual({ name: "window-data-written", payload: { source: "quick", itemIds: [100, 101], tagsChanged: false } });
    await waitFor(() => expect(db.collectFinish).toHaveBeenCalledWith(7, 2), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId("quick-input")).toBeInTheDocument());
  });

  it("文件柜只列普通柜；含文件夹时按所选方式展开并把夹内内容藏出总览", async () => {
    const user = userEvent.setup();
    render(<QuickApp />);
    await screen.findByTestId("quick-input");
    fire("quick-collect", session({ id: 8, paths: ["D:\\Dir", "D:\\x.txt"], invocations: 1 }));
    await screen.findByTestId("collect-folder-mode-both");
    await user.click(screen.getByTestId("collect-folder-mode-both"));
    await user.click(screen.getByTestId("collect-action-cabinet"));
    const cabinets = await screen.findAllByTestId("collect-cabinet-option");
    expect(cabinets.map((el) => el.dataset.cabinetId)).toEqual(["10"]);
    await user.click(cabinets[0]);
    await waitFor(() => expect(db.addItems).toHaveBeenCalled());
    const [paths, context] = vi.mocked(db.addItems).mock.calls[0];
    expect(paths).toEqual(expect.arrayContaining(["D:\\Dir", "D:\\Dir\\sub", "D:\\Dir\\sub\\in.txt", "D:\\x.txt"]));
    expect(context).toEqual({ cabinetId: 10, hideFromAllPaths: expect.arrayContaining(["D:\\Dir\\sub", "D:\\Dir\\sub\\in.txt"]) });
    expect(context!.hideFromAllPaths).not.toContain("D:\\Dir");
    expect(db.setCollectPreference).not.toHaveBeenCalled();
  });

  it("记住的选择直接执行，可改为每次询问；Esc 取消不写入", async () => {
    collect.pref = { action: "import", tagIds: [], cabinetId: null, folderMode: null };
    collect.pending = session({ id: 9, paths: ["D:/a.txt"], invocations: 1 });
    const user = userEvent.setup();
    const { unmount } = render(<QuickApp />);
    const result = await screen.findByTestId("collect-result");
    expect(result).toHaveAttribute("data-auto", "true");
    expect(db.addItems).toHaveBeenCalledWith(["D:/a.txt"], {});
    await user.click(screen.getByTestId("collect-forget"));
    await waitFor(() => expect(db.setCollectPreference).toHaveBeenCalledWith(null));
    expect(await screen.findByTestId("collect-result")).toHaveTextContent("已改为每次询问");
    unmount();

    vi.mocked(db.addItems).mockClear();
    collect.pending = session({ id: 10, paths: ["D:/b.txt"], invocations: 1 });
    render(<QuickApp />);
    await screen.findByTestId("collect-action-import");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(db.collectFinish).toHaveBeenCalledWith(10, 1));
    expect(db.addItems).not.toHaveBeenCalled();
  });
});

describe("QuickApp 收纳入口：剪贴板与拖入", () => {
  it("剪贴板里有文件：提示收纳 N 项，点击或 Ctrl+Shift+V 交给后端并收起提示；唤出时重新读取", async () => {
    collect.clipboard = ["D:\\a.txt", "D:\\b.txt"];
    const { user, input } = await setup();
    const banner = await screen.findByTestId("quick-clipboard");
    expect(banner).toHaveTextContent("收纳剪贴板中的 2 项");
    await user.click(banner);
    await waitFor(() => expect(db.collectSubmit).toHaveBeenCalledWith(["D:\\a.txt", "D:\\b.txt"]));
    expect(screen.queryByTestId("quick-clipboard")).not.toBeInTheDocument();

    collect.clipboard = ["D:\\c.txt"];
    fire(QUICK_SHOWN_EVENT, { t0Ms: Date.now() });
    expect(await screen.findByTestId("quick-clipboard")).toHaveTextContent("收纳剪贴板中的 1 项");
    input.focus();
    await user.keyboard("{Control>}{Shift>}v{/Shift}{/Control}");
    await waitFor(() => expect(db.collectSubmit).toHaveBeenLastCalledWith(["D:\\c.txt"]));
  });

  it("剪贴板没有文件时不提示，Ctrl+Shift+V 不拦截", async () => {
    const { user, input } = await setup();
    await waitFor(() => expect(db.clipboardCollectCandidates).toHaveBeenCalled());
    expect(screen.queryByTestId("quick-clipboard")).not.toBeInTheDocument();
    input.focus();
    await user.keyboard("{Control>}{Shift>}v{/Shift}{/Control}");
    expect(db.collectSubmit).not.toHaveBeenCalled();
  });

  it("拖入：进入时显示「松开即收纳 N 项」，松开交给后端；离开收起遮罩；失败显示原因", async () => {
    await setup();
    await waitFor(() => expect(drop.handler).not.toBeNull());
    act(() => drop.handler!({ payload: { type: "enter", paths: ["D:\\x.txt", "D:\\y"], position: { x: 1, y: 1 } } }));
    expect(screen.getByTestId("quick-drop-overlay")).toHaveTextContent("松开即收纳 2 项");
    act(() => drop.handler!({ payload: { type: "leave" } }));
    expect(screen.queryByTestId("quick-drop-overlay")).not.toBeInTheDocument();

    act(() => drop.handler!({ payload: { type: "enter", paths: ["D:\\x.txt"], position: { x: 1, y: 1 } } }));
    act(() => drop.handler!({ payload: { type: "drop", paths: ["D:\\x.txt"], position: { x: 1, y: 1 } } }));
    expect(screen.queryByTestId("quick-drop-overlay")).not.toBeInTheDocument();
    await waitFor(() => expect(db.collectSubmit).toHaveBeenCalledWith(["D:\\x.txt"]));

    collect.submitError = "没有可收纳的项目：需要是存在的文件或文件夹";
    act(() => drop.handler!({ payload: { type: "drop", paths: ["D:\\gone"], position: { x: 1, y: 1 } } }));
    expect(await screen.findByTestId("quick-status")).toHaveTextContent("收纳失败：没有可收纳的项目");
  });

  it("钉住视图共用本窗口：pin-surface 切到钉住表面并渲染面板；唤出快速搜索立即切回搜索表面", async () => {
    pinStub.view = { surface: "pin", settings: { enabled: true, source: { kind: "cabinet", id: 10 }, mode: "float", edge: "right", topmost: true }, drawer: "collapsed" };
    render(<QuickApp />);
    await waitFor(() => expect(document.documentElement.dataset.surface).toBe("pin"));
    expect(await screen.findByTestId("pin-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("pin-title")).toHaveTextContent("项目"));
    // 只开钉住视图：不做搜索预热（不建索引、不渲染结果行）
    expect(db.quickSearch).not.toHaveBeenCalled();
    fire(QUICK_SHOWN_EVENT, { t0Ms: Date.now(), keepInput: true });
    expect(document.documentElement.dataset.surface).toBe("search");
    expect(screen.getByTestId("quick-input")).toHaveFocus();
    // 第一次唤出搜索才查询，之后保持
    await waitFor(() => expect(screen.getAllByTestId("quick-result")).toHaveLength(2));
    // 未开启时不渲染钉住面板
    fire("pin-surface", { surface: "search", settings: { enabled: false, source: null, mode: "float", edge: "right", topmost: true }, drawer: "collapsed" });
    expect(screen.queryByTestId("pin-panel")).not.toBeInTheDocument();
  });
});

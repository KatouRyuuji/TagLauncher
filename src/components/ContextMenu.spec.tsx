import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { ITEM_REFRESH_EVENT } from "../hooks/useItems";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../lib/db", () => ({
  openInExplorer: vi.fn(async () => {}),
  openInExplorerById: vi.fn(),
  getFolderWatchStatus: vi.fn(async () => ({ masterEnabled: true, activeCount: 0, watchedItemIds: [] })),
}));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

// jsdom 不提供 ResizeObserver：菜单滚动提示只需能订阅
const resizeCallbacks: Array<() => void> = [];
vi.stubGlobal("ResizeObserver", class {
  constructor(cb: () => void) { resizeCallbacks.push(cb); }
  observe() {} unobserve() {} disconnect() {}
});

const item: ItemWithTags = { id: 5, name: "旧名称.exe", path: "D:/旧名称.exe", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [] };
const noop = vi.fn(async () => {});

function renderMenu(onClose = vi.fn(), target: ItemWithTags = item) {
  render(
    <ContextMenu
      item={target}
      cabinets={[]}
      currentCabinetId={null}
      currentCabinetName={null}
      position={{ x: 10, y: 10 }}
      onClose={onClose}
      onLaunch={vi.fn()}
      onRemove={vi.fn()}
      onEditTags={vi.fn()}
      onToggleFavorite={vi.fn()}
      onAddItemToCabinet={noop}
      onRemoveItemFromCabinet={noop}
      onUpdateThumbnail={noop}
    />,
  );
  return onClose;
}

describe("右键「打开所在文件夹」后刷新对象", () => {
  const refreshed: unknown[] = [];
  const listener = (event: Event) => refreshed.push((event as CustomEvent).detail);

  beforeEach(() => {
    vi.clearAllMocks();
    refreshed.length = 0;
    window.addEventListener(ITEM_REFRESH_EVENT, listener);
  });
  afterEach(() => window.removeEventListener(ITEM_REFRESH_EVENT, listener));

  it("成功时按 id 刷新，同步重定位后的名称", async () => {
    vi.mocked(db.openInExplorerById).mockResolvedValue(undefined);
    const onClose = renderMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /打开所在文件夹/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(db.openInExplorerById).toHaveBeenCalledWith(5);
    expect(refreshed).toEqual([{ id: 5 }]);
  });

  it("失败时也按 id 刷新，失效标记即时生效", async () => {
    vi.mocked(db.openInExplorerById).mockRejectedValue(new Error("对象已丢失，无法定位文件"));
    const onClose = renderMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /打开所在文件夹/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshed).toEqual([{ id: 5 }]);
  });
});

describe("右键标签入口", () => {
  beforeEach(() => useAppStore.setState({ batchAddTagOpen: false }));

  it("单选仍是管理当前行标签", async () => {
    const onEditTags = vi.fn();
    render(
      <ContextMenu
        item={item}
        cabinets={[]}
        currentCabinetId={null}
        currentCabinetName={null}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onLaunch={vi.fn()}
        onRemove={vi.fn()}
        onEditTags={onEditTags}
        onToggleFavorite={vi.fn()}
        onAddItemToCabinet={noop}
        onRemoveItemFromCabinet={noop}
        onUpdateThumbnail={noop}
      />,
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "管理标签" }));
    expect(onEditTags).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().batchAddTagOpen).toBe(false);
  });

  it("多选改为加入标签，不打开当前行编辑器", async () => {
    const onEditTags = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        item={item}
        cabinets={[]}
        currentCabinetId={null}
        currentCabinetName={null}
        contextSelection={{ ids: [5, 6], paths: ["D:/a", "D:/b"], favoriteTarget: true }}
        position={{ x: 10, y: 10 }}
        onClose={onClose}
        onLaunch={vi.fn()}
        onRemove={vi.fn()}
        onEditTags={onEditTags}
        onToggleFavorite={vi.fn()}
        onAddItemToCabinet={noop}
        onRemoveItemFromCabinet={noop}
        onUpdateThumbnail={noop}
      />,
    );
    expect(screen.queryByRole("menuitem", { name: "管理标签" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "加入标签" }));
    expect(onEditTags).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().batchAddTagOpen).toBe(true);
  });
});

describe("右键「重命名…」", () => {
  beforeEach(() => useAppStore.setState({ renameItemId: null }));

  it("单个有效对象显示入口，点击打开重命名弹窗并关闭菜单", async () => {
    const onClose = renderMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /重命名/ }));
    expect(useAppStore.getState().renameItemId).toBe(5);
    expect(onClose).toHaveBeenCalled();
  });

  it("失效对象不显示入口", () => {
    renderMenu(vi.fn(), { ...item, is_missing: true });
    expect(screen.queryByRole("menuitem", { name: /重命名/ })).not.toBeInTheDocument();
  });
});

describe("关联柜内的文件夹", () => {
  const folder: ItemWithTags = { id: 8, name: "Sub", path: "D:\\Photos\\Sub", type: "folder", created_at: "2026-01-01", is_favorite: false, tags: [] };

  beforeEach(() => {
    useAppStore.setState({
      cabinets: [{ id: 1, name: "照片", color: "#fff", created_at: "2026-10-10", folder_path: "D:\\Photos", folder_truncated: false, folder_state: "ok" }],
      selectedCabinetId: 1,
    });
  });
  afterEach(() => useAppStore.setState({ cabinets: [], selectedCabinetId: null }));

  it("「打开」改为进入此文件夹，另可在资源管理器中打开", async () => {
    renderMenu(vi.fn(), folder);
    expect(screen.getByRole("menuitem", { name: /进入此文件夹/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /在资源管理器中打开/ }));
    expect(db.openInExplorer).toHaveBeenCalledWith("D:\\Photos\\Sub");
  });
});


describe("贴近窗口底部时悬停「添加到文件柜」", () => {
  const cabinet = { id: 2, name: "收纳", color: "#fff", created_at: "2026-10-10", folder_path: null, folder_truncated: false, folder_state: "ok" } as const;
  afterEach(() => vi.restoreAllMocks());

  it("子菜单展开不会让主菜单复位到原始坐标（不再循环闪烁）", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 300, width: 200, height: 300, toJSON: () => ({}) } as DOMRect,
    );
    const y = window.innerHeight - 20;
    render(
      <ContextMenu
        item={item}
        cabinets={[cabinet]}
        currentCabinetId={null}
        currentCabinetName={null}
        position={{ x: 10, y }}
        onClose={vi.fn()}
        onLaunch={vi.fn()}
        onRemove={vi.fn()}
        onEditTags={vi.fn()}
        onToggleFavorite={vi.fn()}
        onAddItemToCabinet={noop}
        onRemoveItemFromCabinet={noop}
        onUpdateThumbnail={noop}
      />,
    );
    const menu = screen.getAllByRole("menu")[0];
    const clamped = `${window.innerHeight - 300 - 8}px`;
    await waitFor(() => expect(menu.style.top).toBe(clamped));
    await userEvent.hover(screen.getByRole("menuitem", { name: /添加到文件柜/ }));
    expect(screen.getByRole("menuitem", { name: /收纳/ })).toBeInTheDocument();
    expect(menu.style.top).toBe(clamped);
  });
});

describe("BUG-10 菜单内部的原生 contextmenu 不外溢", () => {
  it("菜单项上的 contextmenu 被吞掉，不冒泡到外层（不会叠开空白区菜单）", () => {
    const outer = vi.fn();
    render(
      <div onContextMenu={outer}>
        <ContextMenu
          item={item} cabinets={[]} currentCabinetId={null} currentCabinetName={null}
          position={{ x: 10, y: 10 }} onClose={vi.fn()} onLaunch={vi.fn()} onRemove={vi.fn()}
          onEditTags={vi.fn()} onToggleFavorite={vi.fn()} onAddItemToCabinet={noop}
          onRemoveItemFromCabinet={noop} onUpdateThumbnail={noop}
        />
      </div>,
    );
    const first = screen.getAllByRole("menuitem")[0];
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    first.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("BUG-13 菜单变高后重新夹回视口", () => {
  it("ResizeObserver 回调触发后按新高度重算 top", async () => {
    resizeCallbacks.length = 0;
    const origH = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    let height = 100;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const h = this.getAttribute("role") === "menu" ? height : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: 220, bottom: h, width: 220, height: h, toJSON() {} } as DOMRect;
    });
    try {
      render(
        <ContextMenu
          item={item} cabinets={[]} currentCabinetId={null} currentCabinetName={null}
          position={{ x: 10, y: 480 }} onClose={vi.fn()} onLaunch={vi.fn()} onRemove={vi.fn()}
          onEditTags={vi.fn()} onToggleFavorite={vi.fn()} onAddItemToCabinet={noop}
          onRemoveItemFromCabinet={noop} onUpdateThumbnail={noop}
        />,
      );
      const menu = screen.getAllByRole("menu")[0];
      await waitFor(() => expect(menu.style.top).toBe("480px"));
      // 等挂载时的 rAF 测量跑完，再模拟内容变高
      for (let i = 0; i < 3; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
      expect(menu.style.top).toBe("480px");
      height = 300;
      resizeCallbacks.forEach((cb) => cb());
      await waitFor(() => expect(menu.style.top).toBe(`${600 - 300 - 8}px`));
    } finally {
      spy.mockRestore();
      Object.defineProperty(window, "innerHeight", { configurable: true, value: origH });
    }
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { ITEM_REFRESH_EVENT } from "../hooks/useItems";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";
import * as db from "../lib/db";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../lib/db", () => ({ openInExplorer: vi.fn(), openInExplorerById: vi.fn() }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

// jsdom 不提供 ResizeObserver：菜单滚动提示只需能订阅
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

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

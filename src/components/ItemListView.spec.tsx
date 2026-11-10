import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemListView } from "./ItemListView";
import { useAppStore } from "../stores/appStore";
import { ITEM_LIST_BASE_ROW_HEIGHT, ITEM_LIST_COMPACT_ROW_HEIGHT } from "./ItemRow";
import type { ItemViewProps, ItemWithTags, Tag } from "../types";

vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("../lib/db", () => ({
  // 与 getItemVisual 契约一致：返回 { path, icon_path }，不能是 null（否则 itemVisualCache 读 visual.path 抛错）
  getItemVisual: vi.fn(async (id: number) => ({ path: `D:\\Lib\\item-${id}.txt`, icon_path: null })),
  listIgnoredPaths: vi.fn(async () => []),
}));

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const bounding = HTMLElement.prototype.getBoundingClientRect;

function rowSize(): number {
  return useAppStore.getState().listDensity === "compact" ? ITEM_LIST_COMPACT_ROW_HEIGHT : ITEM_LIST_BASE_ROW_HEIGHT;
}

function isVirtualRow(el: HTMLElement): boolean {
  return el.hasAttribute("data-index") || el.getAttribute("role") === "listitem";
}

function boxOf(el: HTMLElement, height: number) {
  return { x: 0, y: 0, top: 0, left: 0, bottom: height, right: 800, width: 800, height, toJSON() { return {}; } };
}

beforeAll(() => {
  // 滚动口 400px；行按当前密度返回真实行高。一律 400 会让 measureElement 把每行当成整屏高。
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() { return isVirtualRow(this) ? rowSize() : 400; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() { return isVirtualRow(this) ? rowSize() : 400; },
  });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return boxOf(this, isVirtualRow(this) ? rowSize() : 400);
  };
});
afterAll(() => {
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
  HTMLElement.prototype.getBoundingClientRect = bounding;
});

function item(id: number, tags: Tag[] = []): ItemWithTags {
  return {
    id,
    name: `对象 ${id}`,
    path: `D:\\Lib\\item-${id}.txt`,
    type: "text",
    created_at: "2026-01-01",
    is_favorite: false,
    tags,
  };
}

const asyncNoop = async () => {};
const baseProps: Omit<ItemViewProps, "items" | "selectedItemIds" | "onSelectItems" | "loading"> = {
  tags: [],
  cabinets: [],
  currentCabinetId: null,
  onLaunch: asyncNoop,
  onSetTags: asyncNoop,
  onSetManyTags: asyncNoop,
  onRemoveTagFromItem: asyncNoop,
  onAddNewTagToItem: async () => [],
  onToggleFavorite: asyncNoop,
  onAddItemToCabinet: asyncNoop,
  onAddItemsToCabinet: asyncNoop,
  onRemoveItemFromCabinet: asyncNoop,
  onRemoveItemsFromCabinet: asyncNoop,
  onClearCurrentFilter: asyncNoop,
  onRequestRemoveFromApp: asyncNoop,
  onUpdateThumbnail: asyncNoop,
};

function listBox() {
  return screen.getByRole("list", { name: "项目列表" });
}

function firstRowTop(container: HTMLElement): number | null {
  const row = container.querySelector<HTMLElement>("[data-index]");
  if (!row) return null;
  const top = row.style.top;
  return top.endsWith("px") ? Number.parseFloat(top) : Number.parseFloat(top);
}

describe("ItemListView 虚拟列表（F19 可执行检查）", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ listDensity: "comfortable", sortMode: "smart", searchQuery: "", selectedTagIds: [] });
  });

  it("长列表滚到底再换成短列表：内容高度随条数收缩，钳制滚动后第一行从 0 起", () => {
    const long = Array.from({ length: 80 }, (_, index) => item(index + 1));
    const short = long.slice(0, 3);
    const { rerender } = render(
      <div style={{ height: 400 }}>
        <ItemListView {...baseProps} items={long} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />
      </div>,
    );
    const scroller = screen.getByRole("list", { name: "项目列表" }).parentElement?.parentElement as HTMLElement;
    expect(scroller).toBeTruthy();
    act(() => { scroller.scrollTop = 4000; });

    rerender(
      <div style={{ height: 400 }}>
        <ItemListView {...baseProps} items={short} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />
      </div>,
    );
    const box = listBox();
    const height = Number.parseFloat(box.style.height);
    expect(height).toBe(3 * ITEM_LIST_BASE_ROW_HEIGHT + 12);
    // jsdom 不会像 Chromium 那样在 scrollHeight 变矮时钳制 scrollTop；这里只模拟钳制后的可见态。
    act(() => { scroller.scrollTop = 0; });
    rerender(
      <div style={{ height: 400 }}>
        <ItemListView {...baseProps} items={short} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />
      </div>,
    );
    expect(firstRowTop(listBox())).toBe(0);
    expect(listBox().querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });

  it("密度切换后估算行高跟着变", () => {
    const items = Array.from({ length: 12 }, (_, index) => item(index + 1));
    const { rerender, unmount } = render(
      <ItemListView {...baseProps} items={items} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />,
    );
    expect(Number.parseFloat(listBox().style.height)).toBe(12 * ITEM_LIST_BASE_ROW_HEIGHT + 12);
    act(() => { useAppStore.setState({ listDensity: "compact" }); });
    rerender(
      <ItemListView {...baseProps} items={items} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />,
    );
    const row = listBox().querySelector<HTMLElement>('[role="listitem"]');
    expect(row?.style.minHeight).toBe(`${ITEM_LIST_COMPACT_ROW_HEIGHT}px`);
    // jsdom 不发 ResizeObserver；虚拟器会保留已测行高。重挂后按紧凑密度重新 measure。
    unmount();
    render(
      <ItemListView {...baseProps} items={items} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />,
    );
    expect(Number.parseFloat(listBox().style.height)).toBe(12 * ITEM_LIST_COMPACT_ROW_HEIGHT + 12);
    expect(firstRowTop(listBox())).toBe(0);
  });

  it("筛选变短与标签换行后第一行仍贴顶，不留下顶部空洞", () => {
    const tags = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `标签${index + 1}`, color: "#5064d8" }));
    const wrapped = item(1, tags);
    const many = [wrapped, ...Array.from({ length: 40 }, (_, index) => item(index + 2))];
    const { rerender } = render(
      <ItemListView {...baseProps} items={many} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />,
    );
    rerender(
      <ItemListView {...baseProps} items={[wrapped]} loading={false} selectedItemIds={[]} onSelectItems={vi.fn()} />,
    );
    expect(firstRowTop(listBox())).toBe(0);
    expect(screen.getByText("对象 1")).toBeInTheDocument();
  });
});

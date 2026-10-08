import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DraggableTagList } from "./DraggableTagList";
import type { ItemWithTags } from "../types";

const base: ItemWithTags = { id: 1, name: "文件", path: "D:/file.txt", type: "exe", created_at: "2026-01-01", is_favorite: false, tags: [] };
const tagged: ItemWithTags = { ...base, tags: [{ id: 3, name: "工作", color: "#5064d8" }] };
const noop = vi.fn(async () => {});

describe("卡片标签列表的添加入口", () => {
  it("无标签和有标签时都显示「+」，点击打开管理标签", async () => {
    for (const item of [base, tagged]) {
      const add = vi.fn();
      const { unmount } = render(<DraggableTagList item={item} onReorder={noop} onRemoveTag={noop} onAdd={add} />);
      await userEvent.click(screen.getByRole("button", { name: "添加标签" }));
      expect(add).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("点击「+」不向卡片冒泡按下、单击与双击", async () => {
    const parent = { pointerDown: vi.fn(), click: vi.fn(), doubleClick: vi.fn() };
    render(
      <div onPointerDown={parent.pointerDown} onClick={parent.click} onDoubleClick={parent.doubleClick}>
        <DraggableTagList item={tagged} onReorder={noop} onRemoveTag={noop} onAdd={vi.fn()} />
      </div>,
    );
    const button = screen.getByRole("button", { name: "添加标签" });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    expect(parent.pointerDown).not.toHaveBeenCalled();
    expect(parent.click).not.toHaveBeenCalled();
    expect(parent.doubleClick).not.toHaveBeenCalled();
  });

  it("未传 onAdd 时不显示入口，无标签时不渲染列表", () => {
    const { container } = render(<DraggableTagList item={base} onReorder={noop} onRemoveTag={noop} />);
    expect(container).toBeEmptyDOMElement();
  });
});

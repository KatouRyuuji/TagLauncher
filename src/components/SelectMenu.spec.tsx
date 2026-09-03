// ============================================================================
// src/components/SelectMenu.spec.tsx — 主题化下拉选择器交互测试
// ============================================================================
// 覆盖：点击展开/选定/外部点击关闭、键盘（展开/移动/选定/Esc）、分组渲染。
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectMenu } from "./SelectMenu";

const OPTIONS = [
  { value: "smart", label: "智能" },
  { value: "name", label: "名称" },
  { value: "recent", label: "最近使用" },
];

function renderMenu(onChange = vi.fn()) {
  const utils = render(
    <SelectMenu
      value="smart"
      onChange={onChange}
      ariaLabel="排序方式"
      options={OPTIONS}
      className="trigger"
    />,
  );
  return { onChange, ...utils };
}

describe("SelectMenu", () => {
  it("初始只渲染触发按钮，点击后展开列表", () => {
    renderMenu();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "排序方式" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("选定选项回调 onChange 并关闭", () => {
    const onChange = vi.fn();
    renderMenu(onChange);
    fireEvent.click(screen.getByRole("button", { name: "排序方式" }));
    fireEvent.click(screen.getByRole("option", { name: "名称" }));
    expect(onChange).toHaveBeenCalledWith("name");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Esc 关闭且不触发 onChange", () => {
    const onChange = vi.fn();
    renderMenu(onChange);
    const trigger = screen.getByRole("button", { name: "排序方式" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("键盘：ArrowDown 展开并移动高亮，Enter 选定", () => {
    const onChange = vi.fn();
    renderMenu(onChange);
    const trigger = screen.getByRole("button", { name: "排序方式" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    // 展开时高亮定位到当前值 smart（索引 0），下移一格到 name
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("name");
  });

  it("点击组件外部关闭", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "排序方式" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("分组渲染组头且全部选项可选", () => {
    render(
      <SelectMenu
        value="a1"
        onChange={() => {}}
        ariaLabel="当前主题"
        groups={[
          { label: "内置主题", options: [{ value: "a1", label: "霜靛" }] },
          { label: "自定义主题", options: [{ value: "c1", label: "天际流云" }] },
        ]}
        className="trigger"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "当前主题" }));
    expect(screen.getByText("内置主题")).toBeTruthy();
    expect(screen.getByText("自定义主题")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

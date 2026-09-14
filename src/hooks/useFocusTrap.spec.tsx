// ============================================================================
// src/hooks/useFocusTrap.spec.tsx — useFocusTrap 单元测试
// ============================================================================
// 验证焦点陷阱：打开时自动聚焦、Tab 在容器内循环、关闭时恢复焦点。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFocusTrap } from "./useFocusTrap";

function TrapDemo({ active, onClose }: { active: boolean; onClose?: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>({ active });
  return (
    <div>
      <button data-testid="outside-before">外部前</button>
      {active && (
        <div ref={ref} data-testid="trap">
          <input data-testid="first" />
          <button data-testid="middle">中间</button>
          <button data-testid="last" onClick={onClose}>关闭</button>
        </div>
      )}
      <button data-testid="outside-after">外部后</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("激活时自动聚焦到第一个可聚焦元素", () => {
    render(<TrapDemo active={true} />);
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("Tab 在容器内循环，不会逃逸到最后一个元素之后", async () => {
    render(<TrapDemo active={true} />);
    const last = screen.getByTestId("last");
    last.focus();

    await userEvent.tab();

    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("Shift+Tab 在容器内反向循环，不会逃逸到第一个元素之前", async () => {
    render(<TrapDemo active={true} />);
    const first = screen.getByTestId("first");
    first.focus();

    await userEvent.tab({ shift: true });

    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("失活时恢复焦点到激活前的元素", async () => {
    const { rerender } = render(<TrapDemo active={false} />);
    const outside = screen.getByTestId("outside-before");
    outside.focus();
    expect(outside).toHaveFocus();

    rerender(<TrapDemo active={true} />);
    expect(screen.getByTestId("first")).toHaveFocus();

    rerender(<TrapDemo active={false} />);
    expect(outside).toHaveFocus();
  });

  it("隐藏分区与禁用表单控件不进入 Tab 边界", async () => {
    function Demo() {
      const ref = useFocusTrap<HTMLDivElement>({ active: true });
      return <div ref={ref}>
        <div hidden><input autoFocus aria-label="隐藏区输入" /></div>
        <fieldset disabled><input aria-label="禁用区输入" /></fieldset>
        <button>可见操作</button>
        <div style={{ display: "none" }}><button>隐藏操作</button></div>
        <button tabIndex={-1}>程序聚焦</button>
      </div>;
    }
    render(<Demo />);
    const button = screen.getByRole("button", { name: "可见操作" });
    expect(button).toHaveFocus();
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button).toHaveFocus();
  });

  it("暂时没有可用控件时焦点保留在弹层容器", async () => {
    function Demo() {
      const ref = useFocusTrap<HTMLDivElement>({ active: true });
      return <div ref={ref} data-testid="loading-panel"><button disabled>加载中</button></div>;
    }
    render(<Demo />);
    expect(screen.getByTestId("loading-panel")).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByTestId("loading-panel")).toHaveFocus();
  });
});

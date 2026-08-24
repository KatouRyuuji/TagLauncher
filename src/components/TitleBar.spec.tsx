// ============================================================================
// src/components/TitleBar.spec.tsx — 自绘窗口栏单元测试
// ============================================================================
// 锁定窗口控制契约：三个按钮分别调用 minimize / toggleMaximize / close；
// 最大化状态由 isMaximized + onResized 同步，按钮文案随之在「最大化/还原」切换。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleBar } from "./TitleBar";

const { winMock } = vi.hoisted(() => {
  const winMock = {
    isMaximized: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    onResized: vi.fn<(cb: () => void) => Promise<() => void>>(() => Promise.resolve(() => {})),
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { winMock };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => winMock,
}));

describe("TitleBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    winMock.isMaximized.mockImplementation(() => Promise.resolve(false));
  });

  it("渲染拖拽区域与三个窗口控制按钮", () => {
    const { container } = render(<TitleBar />);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最大化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("点击按钮调用对应窗口方法", async () => {
    render(<TitleBar />);
    await userEvent.click(screen.getByRole("button", { name: "最小化" }));
    expect(winMock.minimize).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "最大化" }));
    expect(winMock.toggleMaximize).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(winMock.close).toHaveBeenCalledTimes(1);
  });

  it("窗口已最大化时按钮切换为还原", async () => {
    winMock.isMaximized.mockImplementation(() => Promise.resolve(true));
    render(<TitleBar />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "还原" })).toBeInTheDocument();
    });
  });

  it("窗口尺寸变化时重新同步最大化状态", async () => {
    let resizedCallback: (() => void) | undefined;
    winMock.onResized.mockImplementation((cb) => {
      resizedCallback = cb;
      return Promise.resolve(() => {});
    });

    render(<TitleBar />);
    await waitFor(() => expect(winMock.onResized).toHaveBeenCalledTimes(1));

    winMock.isMaximized.mockImplementation(() => Promise.resolve(true));
    resizedCallback?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "还原" })).toBeInTheDocument();
    });
  });
});

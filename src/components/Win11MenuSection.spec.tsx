import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const menu = vi.hoisted(() => ({
  state: null as unknown as Record<string, unknown>,
  failNext: null as string | null,
}));

const base = (over: Record<string, unknown> = {}) => ({
  supported: true, reason: null, enabled: false, registered: false, registeredVersion: null, privilege: "elevated", bundledVersion: "1.9.1.0", ...over,
});

vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("../lib/db", () => ({
  getWin11Menu: vi.fn(async () => structuredClone(menu.state)),
  setWin11Menu: vi.fn(async (enabled: boolean) => {
    if (menu.failNext) {
      const message = menu.failNext;
      menu.failNext = null;
      throw new Error(message);
    }
    menu.state = base(enabled ? { enabled: true, registered: true, registeredVersion: "1.9.1.0" } : {});
    return structuredClone(menu.state);
  }),
}));

import * as db from "../lib/db";
import { Win11MenuSection } from "./Win11MenuSection";

beforeEach(() => {
  vi.clearAllMocks();
  menu.state = base();
  menu.failNext = null;
});

describe("Win11 一级右键菜单设置", () => {
  it("默认关闭；开启失败显示原因且保持关闭，成功后以后端状态为准，可再关闭", async () => {
    const user = userEvent.setup();
    render(<Win11MenuSection disabled={false} />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    menu.failNext = "注册 Win11 右键菜单失败：0x80073D2B";
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("0x80073D2B");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(db.setWin11Menu).toHaveBeenLastCalledWith(true);
    expect(screen.queryByTestId("win11-menu-stale")).toBeNull();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(db.setWin11Menu).toHaveBeenLastCalledWith(false);
  });

  it("意图开但未注册或版本不符时提示重新注册", async () => {
    const user = userEvent.setup();
    menu.state = base({ enabled: true, registered: true, registeredVersion: "1.8.0.0" });
    render(<Win11MenuSection disabled={false} />);
    expect(await screen.findByTestId("win11-menu-stale")).toHaveTextContent("1.8.0.0");
    await user.click(screen.getByRole("button", { name: "重新注册" }));
    await waitFor(() => expect(screen.queryByTestId("win11-menu-stale")).toBeNull());
    expect(db.setWin11Menu).toHaveBeenCalledWith(true);
  });

  it("说明管理员（UAC）限制；标准用户账户另有明确提示", async () => {
    render(<Win11MenuSection disabled={false} />);
    expect(await screen.findByTestId("win11-menu-limits")).toHaveTextContent("管理员授权（UAC）");
    expect(screen.queryByTestId("win11-menu-standard-user")).toBeNull();
  });

  it("标准用户：提示无法安装未签名组件", async () => {
    menu.state = base({ privilege: "standard" });
    render(<Win11MenuSection disabled={false} />);
    expect(await screen.findByTestId("win11-menu-standard-user")).toHaveTextContent("标准用户");
  });

  it("不支持时只显示原因、不给开关", async () => {
    menu.state = base({ supported: false, reason: "需要 Windows 11（当前 build 19045）" });
    render(<Win11MenuSection disabled={false} />);
    expect(await screen.findByTestId("win11-menu-unsupported")).toHaveTextContent("19045");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

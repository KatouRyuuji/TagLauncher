import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
  state: { globalShortcut: null as string | null, closeAction: "exit" as "exit" | "tray", shortcutError: null as string | null },
  failNext: null as string | null,
}));

vi.mock("../lib/db", () => ({
  getDesktopSettings: vi.fn(async () => ({ ...desktop.state })),
  setGlobalShortcut: vi.fn(async (shortcut: string | null) => {
    if (desktop.failNext) {
      const message = desktop.failNext;
      desktop.failNext = null;
      throw new Error(message);
    }
    desktop.state = { ...desktop.state, globalShortcut: shortcut, shortcutError: null };
    return { ...desktop.state };
  }),
  setCloseAction: vi.fn(async (action: "exit" | "tray") => {
    desktop.state = { ...desktop.state, closeAction: action };
    return { ...desktop.state };
  }),
}));

import * as db from "../lib/db";
import { DesktopSettingsSection } from "./DesktopSettingsSection";

describe("桌面驻留设置", () => {
  beforeEach(() => {
    desktop.state = { globalShortcut: null, closeAction: "exit", shortcutError: null };
    desktop.failNext = null;
    vi.clearAllMocks();
  });

  it("默认未启用快捷键、关闭即退出", async () => {
    render(<DesktopSettingsSection />);
    await waitFor(() => expect(screen.getByTestId("global-shortcut-value")).toHaveTextContent("未启用"));
    expect(screen.getByRole("radio", { name: /退出程序/ })).toHaveAttribute("aria-checked", "true");
    expect(db.setGlobalShortcut).not.toHaveBeenCalled();
  });

  it("录制组合键后注册，清除后回到未启用", async () => {
    render(<DesktopSettingsSection />);
    const record = await screen.findByRole("button", { name: "录制快捷键" });
    await waitFor(() => expect(record).toBeEnabled());
    await userEvent.click(record);
    fireEvent.keyDown(record, { key: "Control", code: "ControlLeft", ctrlKey: true });
    fireEvent.keyDown(record, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    await waitFor(() => expect(db.setGlobalShortcut).toHaveBeenCalledWith("Ctrl+Alt+KeyK"));
    await waitFor(() => expect(screen.getByTestId("global-shortcut-value")).toHaveTextContent("Ctrl + Alt + K"));
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => expect(screen.getByTestId("global-shortcut-value")).toHaveTextContent("未启用"));
    expect(db.setGlobalShortcut).toHaveBeenLastCalledWith(null);
  });

  it("单键不提交，冲突时显示错误并保持旧值", async () => {
    desktop.state.globalShortcut = "Alt+Space";
    render(<DesktopSettingsSection />);
    const record = await screen.findByRole("button", { name: "重新录制" });
    await waitFor(() => expect(record).toBeEnabled());
    await userEvent.click(record);
    fireEvent.keyDown(record, { key: "k", code: "KeyK" });
    expect(await screen.findByTestId("global-shortcut-error")).toHaveTextContent("至少要包含");
    expect(db.setGlobalShortcut).not.toHaveBeenCalled();

    desktop.failNext = "无法注册全局快捷键「Ctrl+KeyJ」，可能已被其他程序占用，已保留原快捷键「Alt+Space」";
    await userEvent.click(record);
    fireEvent.keyDown(record, { key: "j", code: "KeyJ", ctrlKey: true });
    expect(await screen.findByTestId("global-shortcut-error")).toHaveTextContent("已被其他程序占用");
    await waitFor(() => expect(screen.getByTestId("global-shortcut-value")).toHaveTextContent("Alt + 空格"));
  });

  it("切换关闭行为", async () => {
    render(<DesktopSettingsSection />);
    const tray = await screen.findByRole("radio", { name: /最小化到托盘/ });
    await waitFor(() => expect(tray).toBeEnabled());
    await userEvent.click(tray);
    await waitFor(() => expect(tray).toHaveAttribute("aria-checked", "true"));
    expect(db.setCloseAction).toHaveBeenCalledWith("tray");
  });

  it("启动时注册失败的原因可见", async () => {
    desktop.state = { globalShortcut: null, closeAction: "exit", shortcutError: "无法注册全局快捷键「Ctrl+KeyK」" };
    render(<DesktopSettingsSection />);
    expect(await screen.findByTestId("global-shortcut-error")).toHaveTextContent("无法注册");
  });
});

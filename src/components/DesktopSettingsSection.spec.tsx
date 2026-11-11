import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopSettings } from "../lib/desktopShortcut";

const desktop = vi.hoisted(() => ({
  state: null as unknown as DesktopSettings,
  failNext: null as string | null,
  emit: null as ((payload: unknown) => void) | null,
}));

function fresh(over: Partial<DesktopSettings> = {}, accelerator: string | null = null, error: string | null = null): DesktopSettings {
  return {
    hotkeys: [{ action: "toggle_main", label: "显示 / 隐藏主窗口", accelerator, error }],
    closeAction: "exit",
    ignoreFullscreen: true,
    launchMode: "show",
    trayActive: false,
    ...over,
  };
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    desktop.emit = (payload) => handler({ payload });
    return () => {};
  }),
}));

vi.mock("../lib/db", () => ({
  getDesktopSettings: vi.fn(async () => structuredClone(desktop.state)),
  setHotkey: vi.fn(async (_action: string, shortcut: string | null) => {
    if (desktop.failNext) {
      const message = desktop.failNext;
      desktop.failNext = null;
      throw new Error(message);
    }
    desktop.state.hotkeys[0] = { ...desktop.state.hotkeys[0], accelerator: shortcut, error: null };
    return structuredClone(desktop.state);
  }),
  setCloseAction: vi.fn(async (action: "exit" | "tray") => {
    desktop.state = { ...desktop.state, closeAction: action, trayActive: action === "tray" };
    return structuredClone(desktop.state);
  }),
  setHotkeyIgnoreFullscreen: vi.fn(async (enabled: boolean) => {
    desktop.state = { ...desktop.state, ignoreFullscreen: enabled };
    return structuredClone(desktop.state);
  }),
}));

import * as db from "../lib/db";
import { DesktopSettingsSection } from "./DesktopSettingsSection";

const value = () => screen.getByTestId("hotkey-value-toggle_main");

describe("桌面驻留设置", () => {
  beforeEach(() => {
    desktop.state = fresh();
    desktop.failNext = null;
    vi.clearAllMocks();
  });

  it("默认未启用快捷键、关闭即退出、全屏忽略默认开", async () => {
    render(<DesktopSettingsSection />);
    await waitFor(() => expect(value()).toHaveTextContent("未启用"));
    expect(screen.getByText("显示 / 隐藏主窗口")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /退出程序/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "全屏时忽略全局快捷键" })).toHaveAttribute("aria-checked", "true");
    expect(db.setHotkey).not.toHaveBeenCalled();
  });

  it("录制组合键后按动作注册；退出模式下提示全局功能会失效；清除后回到未启用", async () => {
    render(<DesktopSettingsSection />);
    const record = await screen.findByRole("button", { name: "录制快捷键：显示 / 隐藏主窗口" });
    await userEvent.click(record);
    fireEvent.keyDown(record, { key: "Control", code: "ControlLeft", ctrlKey: true });
    fireEvent.keyDown(record, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    await waitFor(() => expect(db.setHotkey).toHaveBeenCalledWith("toggle_main", "Ctrl+Alt+KeyK"));
    await waitFor(() => expect(value()).toHaveTextContent("Ctrl + Alt + K"));
    expect(screen.getByTestId("close-exit-warning")).toHaveTextContent("全局快捷键随之失效");
    await userEvent.click(screen.getByRole("button", { name: "清除：显示 / 隐藏主窗口" }));
    await waitFor(() => expect(value()).toHaveTextContent("未启用"));
    expect(db.setHotkey).toHaveBeenLastCalledWith("toggle_main", null);
    expect(screen.queryByTestId("close-exit-warning")).toBeNull();
  });

  it("单键不提交，冲突时显示错误并保持旧值", async () => {
    desktop.state = fresh({}, "Alt+Space");
    render(<DesktopSettingsSection />);
    const record = await screen.findByRole("button", { name: "重新录制：显示 / 隐藏主窗口" });
    await userEvent.click(record);
    fireEvent.keyDown(record, { key: "k", code: "KeyK" });
    expect(await screen.findByTestId("hotkey-error-toggle_main")).toHaveTextContent("至少要包含");
    expect(db.setHotkey).not.toHaveBeenCalled();

    desktop.failNext = "无法注册全局快捷键「Ctrl+KeyJ」，可能已被其他程序占用，已保留原快捷键「Alt+Space」";
    await userEvent.click(record);
    fireEvent.keyDown(record, { key: "j", code: "KeyJ", ctrlKey: true });
    expect(await screen.findByTestId("hotkey-error-toggle_main")).toHaveTextContent("已被其他程序占用");
    await waitFor(() => expect(value()).toHaveTextContent("Alt + 空格"));
  });

  it("切换关闭行为与全屏忽略", async () => {
    render(<DesktopSettingsSection />);
    const tray = await screen.findByRole("radio", { name: /最小化到托盘/ });
    await waitFor(() => expect(tray).toBeEnabled());
    await userEvent.click(tray);
    await waitFor(() => expect(tray).toHaveAttribute("aria-checked", "true"));
    expect(db.setCloseAction).toHaveBeenCalledWith("tray");
    await userEvent.click(screen.getByRole("switch", { name: "全屏时忽略全局快捷键" }));
    await waitFor(() => expect(db.setHotkeyIgnoreFullscreen).toHaveBeenCalledWith(false));
  });

  it("启动时注册失败的原因可见；后端广播的设置变化会同步", async () => {
    desktop.state = fresh({}, null, "无法注册全局快捷键「Ctrl+KeyK」");
    render(<DesktopSettingsSection />);
    expect(await screen.findByTestId("hotkey-error-toggle_main")).toHaveTextContent("无法注册");
    await waitFor(() => expect(desktop.emit).not.toBeNull());
    act(() => desktop.emit?.(fresh({ closeAction: "tray" }, "Ctrl+Alt+KeyT")));
    await waitFor(() => expect(value()).toHaveTextContent("Ctrl + Alt + T"));
    expect(screen.getByRole("radio", { name: /最小化到托盘/ })).toHaveAttribute("aria-checked", "true");
  });
});

import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { presetThemes, THEME_FAMILIES } from "../themes";

const mocks = vi.hoisted(() => ({ ai: vi.fn(), sync: vi.fn(), data: vi.fn(), update: vi.fn(), mods: vi.fn(), setTheme: vi.fn() }));
vi.mock("./ThemeProvider", () => ({ useThemeContext: () => ({
  currentTheme: presetThemes[0], availableThemes: presetThemes, setTheme: mocks.setTheme,
  effectiveMode: "light", colorMode: "light", changeColorMode: vi.fn(),
}) }));
vi.mock("./AiSettingsSection", () => ({ AiSettingsSection: () => {
  const [value, setValue] = useState("");
  useEffect(() => { mocks.ai(); }, []);
  return <input aria-label="AI 地址" value={value} onChange={(event) => setValue(event.target.value)} />;
} }));
vi.mock("./SyncSettingsSection", () => ({ SyncSettingsSection: () => {
  useEffect(() => { mocks.sync(); }, []);
  return <input aria-label="同步地址" />;
} }));
vi.mock("./DataSettingsSection", () => ({ DataSettingsSection: () => { useEffect(() => { mocks.data(); }, []); return null; } }));
vi.mock("./UpdateSettingsSection", () => ({ UpdateSettingsSection: () => { useEffect(() => { mocks.update(); }, []); return null; } }));
vi.mock("./ModManagerPanel", () => ({ ModManagerPanel: () => { useEffect(() => { mocks.mods(); }, []); return null; } }));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("设置分区", () => {
  it("只挂载访问过的区块，返回区块时保留草稿", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open onClose={vi.fn()} />);
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.data).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.mods).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "AI 打标", exact: true }));
    await user.type(screen.getByLabelText("AI 地址"), "https://draft.example");
    await user.click(screen.getByRole("button", { name: "云同步", exact: true }));
    expect(screen.getByLabelText("AI 地址")).not.toBeVisible();
    expect(screen.getByLabelText("同步地址")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "AI 打标", exact: true }));
    expect(screen.getByLabelText("AI 地址")).toHaveValue("https://draft.example");
    expect(mocks.ai).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("taglauncher.settings_section")).toBe("ai");
  });

  it("重新打开时定位持久化区块，其他区块保持未挂载", () => {
    localStorage.setItem("taglauncher.settings_section", "sync");
    render(<SettingsPanel open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "云同步", exact: true })).toHaveAttribute("aria-current", "page");
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.ai).not.toHaveBeenCalled();
  });

  it("主题预览使用当前模式对应的内置主题", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    const family = THEME_FAMILIES.find((entry) => entry.name === "藤色")!;
    await userEvent.click(screen.getByRole("button", { name: "应用藤色主题" }));
    expect(mocks.setTheme).toHaveBeenCalledWith(family.light);
  });
});

import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_FAMILY, presetThemes, THEME_FAMILIES, resolveFamilyThemeId } from "../themes";
import type { ThemeDefinition } from "../types/theme";

const mocks = vi.hoisted(() => ({ ai: vi.fn(), sync: vi.fn(), data: vi.fn(), update: vi.fn(), mods: vi.fn(), setTheme: vi.fn() }));
const themeState = vi.hoisted(() => ({
  currentTheme: { id: "", name: "", variables: {} } as ThemeDefinition,
  availableThemes: [] as ThemeDefinition[],
  effectiveMode: "light" as "light" | "dark",
}));
vi.mock("./ThemeProvider", () => ({ useThemeContext: () => ({
  currentTheme: themeState.currentTheme, availableThemes: themeState.availableThemes, setTheme: mocks.setTheme,
  effectiveMode: themeState.effectiveMode, colorMode: "light", changeColorMode: vi.fn(),
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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  themeState.currentTheme = presetThemes[0];
  themeState.availableThemes = presetThemes;
  themeState.effectiveMode = "light";
});

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

  it("主题 Gallery 使用当前模式对应的内置主题", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    const family = THEME_FAMILIES.find((entry) => entry.name === "藤色")!;
    expect(screen.getByRole("radiogroup", { name: "官方配色" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "当前主题" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "藤色" }));
    expect(mocks.setTheme).toHaveBeenCalledWith(family.light);
  });

  it("当前为自定义主题时选「使用上方官方配色」会套用官方家族", async () => {
    const custom: ThemeDefinition = {
      ...presetThemes[0],
      id: "custom-sky",
      name: "天空",
      isPreset: false,
      source: "custom",
    };
    themeState.currentTheme = custom;
    themeState.availableThemes = [...presetThemes, custom];
    render(<SettingsPanel open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "当前主题" }));
    await userEvent.click(screen.getByRole("option", { name: "使用上方官方配色" }));
    expect(mocks.setTheme).toHaveBeenCalledWith(resolveFamilyThemeId(DEFAULT_FAMILY, "light"));
  });
});

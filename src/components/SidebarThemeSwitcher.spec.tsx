// ============================================================================
// src/components/SidebarThemeSwitcher.spec.tsx — 首页主题色点与亮/暗分段
// ----------------------------------------------------------------------------
// 渲染侧栏里实际挂载的快捷切换控件（经 ThemeProvider → 真实 setTheme /
// changeColorMode）。断言官方家族色点齐全、点击走家族×当前模式的主题 id、
// 亮/暗写入显式模式、非官方主题时亮/暗禁用。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeProvider";
import { Sidebar } from "./Sidebar";
import { COLOR_MODE_KEY } from "../lib/colorMode";
import { THEME_FAMILIES, findFamilyByThemeId, resolveFamilyThemeId } from "../themes";

const mocks = vi.hoisted(() => ({
  getCurrentTheme: vi.fn(),
  getCustomThemes: vi.fn(),
  getThemeDirectoryInfo: vi.fn(),
  setCurrentTheme: vi.fn(),
  getCabinetItemCounts: vi.fn(),
  installThemeFile: vi.fn(),
  exportThemeFile: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getCurrentTheme: mocks.getCurrentTheme,
  getCustomThemes: mocks.getCustomThemes,
  getThemeDirectoryInfo: mocks.getThemeDirectoryInfo,
  setCurrentTheme: mocks.setCurrentTheme,
  getCabinetItemCounts: mocks.getCabinetItemCounts,
  installThemeFile: mocks.installThemeFile,
  exportThemeFile: mocks.exportThemeFile,
}));

const CUSTOM_THEME = {
  id: "custom-theme-1",
  name: "Custom Theme",
  isPreset: false,
  source: "custom" as const,
  variables: { "bg-base": "#ffffff", "accent-primary": "#123456" },
};

function renderHomepageSidebar() {
  return render(
    <ThemeProvider>
      <Sidebar
        tags={[]}
        cabinets={[]}
        onAddTag={async () => 1}
        onUpdateTag={async () => {}}
        onRemoveTag={async () => {}}
        onAddCabinet={async () => 1}
        onUpdateCabinet={async () => {}}
        onRemoveCabinet={async () => {}}
        onAddTagToItem={async () => {}}
        onAddTagRelation={async () => {}}
        onRemoveTagRelation={async () => {}}
        allItems={[]}
      />
    </ThemeProvider>,
  );
}

async function waitForSwitcher() {
  await waitFor(() => {
    expect(screen.getByRole("radiogroup", { name: "官方主题" })).toBeInTheDocument();
  });
}

describe("首页官方主题色点与亮/暗分段", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(COLOR_MODE_KEY, "light");
    mocks.getCurrentTheme.mockResolvedValue(THEME_FAMILIES[0].light);
    mocks.getCustomThemes.mockResolvedValue({ themes: [], errors: [] });
    mocks.getThemeDirectoryInfo.mockResolvedValue(null);
    mocks.setCurrentTheme.mockResolvedValue(undefined);
    mocks.getCabinetItemCounts.mockResolvedValue(new Map());
  });

  it("列出全部官方家族色点，当前家族为选中态", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();

    for (const family of THEME_FAMILIES) {
      expect(screen.getByRole("radio", { name: family.name })).toBeInTheDocument();
    }

    const current = screen.getByRole("radio", { name: THEME_FAMILIES[0].name });
    expect(current).toHaveAttribute("aria-checked", "true");
    for (const family of THEME_FAMILIES.slice(1)) {
      expect(screen.getByRole("radio", { name: family.name })).toHaveAttribute("aria-checked", "false");
    }
  });

  it("点击色点后真实 setTheme 路径收到该家族在当前模式下的主题 id", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();
    mocks.setCurrentTheme.mockClear();

    const targetFamily = THEME_FAMILIES.find((family) => family.id !== THEME_FAMILIES[0].id);
    expect(targetFamily).toBeTruthy();
    if (!targetFamily) return;

    const expectedId = resolveFamilyThemeId(targetFamily, "light");
    await userEvent.click(screen.getByRole("radio", { name: targetFamily.name }));

    await waitFor(() => {
      expect(mocks.setCurrentTheme).toHaveBeenCalledWith(expectedId);
    });
    expect(document.documentElement.getAttribute("data-theme-id")).toBe(expectedId);
    expect(screen.getByRole("radio", { name: targetFamily.name })).toHaveAttribute("aria-checked", "true");
    expect(findFamilyByThemeId(expectedId)?.id).toBe(targetFamily.id);
  });

  it("点击日光与月牙分别把外观模式设为 light 与 dark，选中态跟随", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();
    mocks.setCurrentTheme.mockClear();

    const family = THEME_FAMILIES[0];
    await userEvent.click(screen.getByRole("radio", { name: "暗色" }));
    await waitFor(() => {
      expect(localStorage.getItem(COLOR_MODE_KEY)).toBe("dark");
      expect(mocks.setCurrentTheme).toHaveBeenCalledWith(resolveFamilyThemeId(family, "dark"));
    });
    expect(screen.getByRole("radio", { name: "暗色" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "亮色" })).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.getAttribute("data-theme-id")).toBe(resolveFamilyThemeId(family, "dark"));

    mocks.setCurrentTheme.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: "亮色" }));
    await waitFor(() => {
      expect(localStorage.getItem(COLOR_MODE_KEY)).toBe("light");
      expect(mocks.setCurrentTheme).toHaveBeenCalledWith(resolveFamilyThemeId(family, "light"));
    });
    expect(screen.getByRole("radio", { name: "亮色" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "暗色" })).toHaveAttribute("aria-checked", "false");
  });

  it("当前主题不属于官方家族时亮/暗控件 disabled 且不调用模式切换", async () => {
    mocks.getCurrentTheme.mockResolvedValue(CUSTOM_THEME.id);
    mocks.getCustomThemes.mockResolvedValue({ themes: [CUSTOM_THEME], errors: [] });

    renderHomepageSidebar();
    await waitForSwitcher();
    mocks.setCurrentTheme.mockClear();
    const modeBefore = localStorage.getItem(COLOR_MODE_KEY);

    const light = screen.getByRole("radio", { name: "亮色" });
    const dark = screen.getByRole("radio", { name: "暗色" });
    expect(light).toBeDisabled();
    expect(dark).toBeDisabled();

    await userEvent.click(light);
    await userEvent.click(dark);

    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe(modeBefore);
    expect(mocks.setCurrentTheme).not.toHaveBeenCalled();
  });

  it("色点可用方向键切换家族", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();
    mocks.setCurrentTheme.mockClear();

    const first = screen.getByRole("radio", { name: THEME_FAMILIES[0].name });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");

    const nextFamily = THEME_FAMILIES[1];
    const expectedId = resolveFamilyThemeId(nextFamily, "light");
    await waitFor(() => {
      expect(mocks.setCurrentTheme).toHaveBeenCalledWith(expectedId);
    });
    expect(screen.getByRole("radio", { name: nextFamily.name })).toHaveAttribute("aria-checked", "true");
  });

  it("亮/暗分段可用方向键切换外观模式", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();
    mocks.setCurrentTheme.mockClear();

    screen.getByRole("radio", { name: "亮色" }).focus();
    await userEvent.keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(localStorage.getItem(COLOR_MODE_KEY)).toBe("dark");
      expect(mocks.setCurrentTheme).toHaveBeenCalledWith(resolveFamilyThemeId(THEME_FAMILIES[0], "dark"));
    });
    expect(screen.getByRole("radio", { name: "暗色" })).toHaveAttribute("aria-checked", "true");
  });
});

// ============================================================================
// src/components/SidebarThemeSwitcher.persist.spec.tsx — 主题/外观模式持久化
// ----------------------------------------------------------------------------
// 驱动真实 setTheme / changeColorMode（mock 仅覆盖 Tauri/db 传输）。
// 色点切换后持久化的主题 id 为该家族×当前模式；亮/暗切换后持久化 light/dark，
// 且官方家族主题 id 解析到对应一侧。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeProvider";
import { Sidebar } from "./Sidebar";
import { COLOR_MODE_KEY } from "../lib/colorMode";
import { THEME_FAMILIES, resolveFamilyThemeId } from "../themes";

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

describe("首页主题快捷切换持久化", () => {
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

  it("色点切换后持久化的主题 id 为该家族×当前模式", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();
    mocks.setCurrentTheme.mockClear();

    const family = THEME_FAMILIES[2];
    const expectedId = resolveFamilyThemeId(family, "light");
    await userEvent.click(screen.getByRole("radio", { name: family.name }));

    await waitFor(() => {
      expect(mocks.setCurrentTheme).toHaveBeenLastCalledWith(expectedId);
    });
    expect(document.documentElement.getAttribute("data-theme-id")).toBe(expectedId);
  });

  it("亮/暗切换后持久化模式为 light 或 dark，且主题 id 解析到对应一侧", async () => {
    renderHomepageSidebar();
    await waitForSwitcher();

    const family = THEME_FAMILIES[3];
    await userEvent.click(screen.getByRole("radio", { name: family.name }));
    await waitFor(() => {
      expect(mocks.setCurrentTheme).toHaveBeenCalledWith(resolveFamilyThemeId(family, "light"));
    });
    mocks.setCurrentTheme.mockClear();

    await userEvent.click(screen.getByRole("radio", { name: "暗色" }));
    await waitFor(() => {
      expect(localStorage.getItem(COLOR_MODE_KEY)).toBe("dark");
      expect(mocks.setCurrentTheme).toHaveBeenLastCalledWith(resolveFamilyThemeId(family, "dark"));
    });
    expect(document.documentElement.getAttribute("data-theme-id")).toBe(
      resolveFamilyThemeId(family, "dark"),
    );

    mocks.setCurrentTheme.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: "亮色" }));
    await waitFor(() => {
      expect(localStorage.getItem(COLOR_MODE_KEY)).toBe("light");
      expect(mocks.setCurrentTheme).toHaveBeenLastCalledWith(resolveFamilyThemeId(family, "light"));
    });
    expect(document.documentElement.getAttribute("data-theme-id")).toBe(
      resolveFamilyThemeId(family, "light"),
    );
  });
});

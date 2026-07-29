// 验证 useTheme 的 importTheme → setTheme 竞态：
// refreshCustomThemes 内 setCustomThemes 后，紧接着 setTheme(newId) 时
// availableThemesRef 是否已包含新主题（effect 是否已 flush）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const newTheme = {
    id: "imported-theme",
    name: "Imported",
    isPreset: false,
    variables: { "bg-base": "#fff" },
  };
  return {
    newTheme,
    getCurrentTheme: vi.fn().mockResolvedValue("dark"),
    getCustomThemes: vi.fn().mockResolvedValue({ themes: [], errors: [] }),
    getThemeDirectoryInfo: vi.fn().mockResolvedValue(null),
    setCurrentTheme: vi.fn().mockResolvedValue(undefined),
    installThemeFile: vi.fn().mockResolvedValue({
      theme: newTheme,
      replaced: false,
      validation_issues: [],
    }),
    exportThemeFile: vi.fn(),
  };
});

vi.mock("../lib/db", () => ({
  getCurrentTheme: mocks.getCurrentTheme,
  getCustomThemes: mocks.getCustomThemes,
  getThemeDirectoryInfo: mocks.getThemeDirectoryInfo,
  setCurrentTheme: mocks.setCurrentTheme,
  installThemeFile: mocks.installThemeFile,
  exportThemeFile: mocks.exportThemeFile,
}));

import { useTheme } from "./useTheme";

describe("useTheme 导入主题后 setTheme 竞态", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentTheme.mockResolvedValue("dark");
    mocks.getCustomThemes.mockResolvedValue({ themes: [], errors: [] });
    mocks.getThemeDirectoryInfo.mockResolvedValue(null);
  });

  it("importTheme 返回后立即 setTheme 应能切换到新主题", async () => {
    const { result } = renderHook(() => useTheme());

    // 等待初始化完成
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);

    // 模拟导入：getCustomThemes 返回新主题
    mocks.getCustomThemes.mockResolvedValue({ themes: [mocks.newTheme], errors: [] });
    mocks.installThemeFile.mockResolvedValue({
      theme: mocks.newTheme,
      replaced: false,
      validation_issues: [],
    });

    let importedId = "";
    await act(async () => {
      const r = await result.current.importTheme("C:/tmp/theme.json");
      importedId = r.theme.id;
      // 模拟 SettingsPanel 的紧接调用
      await result.current.setTheme(importedId);
    });

    expect(importedId).toBe("imported-theme");
    expect(result.current.currentTheme.id).toBe("imported-theme");
    // 持久化的也应是新主题，而不是 fallback 的默认主题
    expect(mocks.setCurrentTheme).toHaveBeenLastCalledWith("imported-theme");
  });
});

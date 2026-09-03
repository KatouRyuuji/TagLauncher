import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ThemeDefinition,
  ThemeDirectoryInfo,
  ThemeExportPayload,
  ThemeInstallResult,
} from "../types/theme";
import { useTheme } from "../hooks/useTheme";
import type { ColorMode, ResolvedColorMode } from "../lib/colorMode";

interface ThemeContextValue {
  currentTheme: ThemeDefinition;
  availableThemes: ThemeDefinition[];
  setTheme: (themeId: string) => Promise<void>;
  refreshCustomThemes: () => Promise<void>;
  importTheme: (sourcePath: string) => Promise<ThemeInstallResult>;
  exportTheme: (theme: ThemeDefinition, targetPath: string) => Promise<ThemeExportPayload>;
  themeDirectoryInfo: ThemeDirectoryInfo | null;
  activeVariant: string | undefined;
  setActiveVariant: (variant: string | undefined) => void;
  loading: boolean;
  /** 亮/暗模式偏好（light/dark/system） */
  colorMode: ColorMode;
  /** 求值后的生效模式（system 已解析） */
  effectiveMode: ResolvedColorMode;
  changeColorMode: (mode: ColorMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const {
    currentTheme,
    availableThemes,
    setTheme,
    refreshCustomThemes,
    importTheme,
    exportTheme,
    themeDirectoryInfo,
    activeVariant,
    setActiveVariant,
    loading,
    colorMode,
    effectiveMode,
    changeColorMode,
  } = useTheme();

  useLayoutEffect(() => {
    if (!loading) {
      document.documentElement.removeAttribute("data-app-preparing");
      requestAnimationFrame(() => {
        void getCurrentWindow().show().catch(() => {});
      });
    }
  }, [loading]);

  if (loading) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        availableThemes,
        setTheme,
        refreshCustomThemes,
        importTheme,
        exportTheme,
        themeDirectoryInfo,
        activeVariant,
        setActiveVariant,
        loading,
        colorMode,
        effectiveMode,
        changeColorMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used within ThemeProvider");
  return ctx;
}

/** 宽松版：Provider 缺失（如组件脱离 App 的单元测试）时返回 null，由调用方降级 */
export function useThemeContextOptional() {
  return useContext(ThemeContext);
}

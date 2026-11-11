import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { getLaunchMode, wakeDataSync } from "../lib/db";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { restoreStateCurrent, StateFlags } from "@tauri-apps/plugin-window-state";
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
        // 后台启动（--background，F18）：不显示主窗，只驻托盘；读不到启动方式按显示处理
        void Promise.resolve()
          .then(() => getLaunchMode())
          .catch(() => "show" as const)
          .then((mode) => {
            if (mode === "background") return;
            // 上次最大化时，恢复会直接以最大化显示窗口；否则只是显示
            return restoreStateCurrent(StateFlags.MAXIMIZED)
              .catch(() => {})
              .then(() => getCurrentWindow().show())
              // 显示即检测外部写入（启动期主窗隐藏时检测间隔较长；无焦点显示不触发获焦检测）
              .then(() => wakeDataSync())
              .catch(() => {});
          })
          .catch(() => {});
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

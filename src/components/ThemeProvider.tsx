import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ThemeDefinition,
  ThemeDirectoryInfo,
  ThemeExportPayload,
  ThemeInstallResult,
} from "../types/theme";
import { useTheme } from "../hooks/useTheme";

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

import { createContext, useContext, type ReactNode } from "react";
import type { ThemeDefinition } from "../types/theme";
import { useTheme } from "../hooks/useTheme";

interface ThemeContextValue {
  currentTheme: ThemeDefinition;
  availableThemes: ThemeDefinition[];
  setTheme: (themeId: string) => Promise<void>;
  refreshCustomThemes: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { currentTheme, availableThemes, setTheme, refreshCustomThemes } = useTheme();

  return (
    <ThemeContext.Provider value={{ currentTheme, availableThemes, setTheme, refreshCustomThemes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used within ThemeProvider");
  return ctx;
}

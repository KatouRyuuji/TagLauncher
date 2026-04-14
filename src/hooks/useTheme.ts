import { useState, useEffect, useCallback } from "react";
import type { ThemeDefinition } from "../types/theme";
import { presetThemes, getPresetTheme, getDefaultTheme } from "../themes";
import { applyTheme } from "../lib/theme";
import { notifyThemeChange } from "../lib/modApi";
import * as db from "../lib/db";

// ── 自定义事件类型（modRuntime 用来通知 theme mod 的增删）─────────────
export const MOD_THEME_ADDED = "mod-theme-added";
export const MOD_THEME_REMOVED = "mod-theme-removed";

export function useTheme() {
  const [currentTheme, setCurrentThemeState] = useState<ThemeDefinition>(getDefaultTheme());
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>([]);
  const [modThemes, setModThemes] = useState<ThemeDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  // 合并所有来源的主题列表（预设 + 自定义文件 + mod 提供）
  const availableThemes = [...presetThemes, ...customThemes, ...modThemes];

  // 从任意来源查找主题
  const findTheme = useCallback(
    (id: string): ThemeDefinition | undefined =>
      presetThemes.find((t) => t.id === id) ??
      customThemes.find((t) => t.id === id) ??
      modThemes.find((t) => t.id === id),
    [customThemes, modThemes],
  );

  // 初始化：加载持久化主题 ID + 自定义主题文件
  useEffect(() => {
    const init = async () => {
      try {
        // 并行加载
        const [themeId, customs] = await Promise.all([
          db.getCurrentTheme().catch(() => "dark"),
          db.getCustomThemes().catch(() => [] as ThemeDefinition[]),
        ]);

        setCustomThemes(customs);

        // 在预设 + 自定义中查找，找不到则用默认
        const allThemes = [...presetThemes, ...customs];
        const theme = allThemes.find((t) => t.id === themeId) ?? getDefaultTheme();
        setCurrentThemeState(theme);
        applyTheme(theme);
      } catch {
        applyTheme(getDefaultTheme());
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, []);

  // 监听 modRuntime 发出的 mod 主题增删事件
  useEffect(() => {
    const handleAdded = (e: Event) => {
      const theme = (e as CustomEvent<ThemeDefinition>).detail;
      setModThemes((prev) => {
        const exists = prev.find((t) => t.id === theme.id);
        return exists ? prev.map((t) => (t.id === theme.id ? theme : t)) : [...prev, theme];
      });
    };

    const handleRemoved = (e: Event) => {
      const themeId = (e as CustomEvent<string>).detail;
      setModThemes((prev) => prev.filter((t) => t.id !== themeId));
      // 如果当前正在使用被移除的 mod 主题，回退到默认
      setCurrentThemeState((current) => {
        if (current.id === themeId) {
          const fallback = getPresetTheme("dark") ?? getDefaultTheme();
          applyTheme(fallback);
          void db.setCurrentTheme(fallback.id).catch(() => {});
          return fallback;
        }
        return current;
      });
    };

    window.addEventListener(MOD_THEME_ADDED, handleAdded);
    window.addEventListener(MOD_THEME_REMOVED, handleRemoved);
    return () => {
      window.removeEventListener(MOD_THEME_ADDED, handleAdded);
      window.removeEventListener(MOD_THEME_REMOVED, handleRemoved);
    };
  }, []);

  const setTheme = useCallback(
    async (themeId: string) => {
      const theme = findTheme(themeId) ?? getDefaultTheme();
      setCurrentThemeState(theme);
      applyTheme(theme);
      notifyThemeChange(themeId);
      try {
        await db.setCurrentTheme(themeId);
      } catch {
        // 静默失败
      }
    },
    [findTheme],
  );

  /** 重新扫描 themes/ 目录（用户安装新主题后可手动刷新） */
  const refreshCustomThemes = useCallback(async () => {
    try {
      const customs = await db.getCustomThemes();
      setCustomThemes(customs);
    } catch {
      // 静默失败
    }
  }, []);

  return {
    currentTheme,
    availableThemes,
    setTheme,
    loading,
    refreshCustomThemes,
  };
}

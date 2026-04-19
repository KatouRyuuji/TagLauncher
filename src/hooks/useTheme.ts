import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  ThemeDefinition,
  ThemeDirectoryInfo,
  ThemeExportPayload,
  ThemeInstallResult,
} from "../types/theme";
import {
  presetThemes,
  getPresetTheme,
  getDefaultTheme,
  toExportableTheme,
  withDefaultThemeVariables,
} from "../themes";
import { applyTheme } from "../lib/theme";
import { notifyThemeChange } from "../lib/modApi";
import * as db from "../lib/db";

export const MOD_THEME_ADDED = "mod-theme-added";
export const MOD_THEME_REMOVED = "mod-theme-removed";

function showToast(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", {
      detail: { message, type },
    }),
  );
}

function normalizeTheme(theme: ThemeDefinition, source: ThemeDefinition["source"]): ThemeDefinition {
  const normalized = withDefaultThemeVariables(theme);
  return {
    ...normalized,
    isPreset: source === "preset",
    source,
  };
}

export function useTheme() {
  const [currentThemeId, setCurrentThemeId] = useState(getDefaultTheme().id);
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>([]);
  const [modThemes, setModThemes] = useState<ThemeDefinition[]>([]);
  const [themeDirectoryInfo, setThemeDirectoryInfo] = useState<ThemeDirectoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const desiredThemeIdRef = useRef(getDefaultTheme().id);
  const customThemesRef = useRef<ThemeDefinition[]>([]);
  const loadErrorSignatureRef = useRef("");

  const availableThemes = useMemo(
    () => [
      ...presetThemes.map((theme) => normalizeTheme(theme, "preset")),
      ...customThemes.map((theme) => normalizeTheme(theme, "custom")),
      ...modThemes.map((theme) => normalizeTheme(theme, "mod")),
    ],
    [customThemes, modThemes],
  );

  const findTheme = useCallback(
    (id: string): ThemeDefinition | undefined => availableThemes.find((theme) => theme.id === id),
    [availableThemes],
  );

  const currentTheme = useMemo(
    () => findTheme(currentThemeId) ?? getDefaultTheme(),
    [currentThemeId, findTheme],
  );

  const applyAndBroadcast = useCallback((theme: ThemeDefinition) => {
    const normalized = normalizeTheme(theme, theme.source ?? (theme.isPreset ? "preset" : "custom"));
    applyTheme(normalized);
    notifyThemeChange(normalized.id);
  }, []);

  const syncCurrentTheme = useCallback(
    async (nextThemeId: string, persist = false) => {
      desiredThemeIdRef.current = nextThemeId;
      const theme = findTheme(nextThemeId) ?? getDefaultTheme();
      setCurrentThemeId(theme.id);
      applyAndBroadcast(theme);
      if (persist) {
        try {
          await db.setCurrentTheme(theme.id);
        } catch {
          // 静默失败
        }
      }
    },
    [applyAndBroadcast, findTheme],
  );

  const refreshCustomThemes = useCallback(async () => {
    try {
      const [result, directoryInfo] = await Promise.all([
        db.getCustomThemes(),
        db.getThemeDirectoryInfo().catch(() => null),
      ]);

      for (const err of result.errors) {
        showToast(`自定义主题 "${err.file_name}" 加载失败：${err.error}`, "error");
      }
      loadErrorSignatureRef.current = JSON.stringify(result.errors);

      const themes = result.themes.map((theme) => normalizeTheme(theme, "custom"));
      customThemesRef.current = themes;
      setCustomThemes(themes);
      if (directoryInfo) {
        setThemeDirectoryInfo(directoryInfo);
      }

      const desired = desiredThemeIdRef.current;
      const desiredTheme =
        presetThemes.find((theme) => theme.id === desired) ??
        themes.find((theme) => theme.id === desired) ??
        modThemes.find((theme) => theme.id === desired);

      if (desiredTheme) {
        setCurrentThemeId(desiredTheme.id);
        applyAndBroadcast(desiredTheme);
      } else if (currentThemeId === desired) {
        const fallback = getDefaultTheme();
        setCurrentThemeId(fallback.id);
        applyAndBroadcast(fallback);
        void db.setCurrentTheme(fallback.id).catch(() => {});
      }
    } catch {
      // 静默失败
    }
  }, [applyAndBroadcast, currentThemeId, modThemes]);

  useEffect(() => {
    customThemesRef.current = customThemes;
  }, [customThemes]);

  useEffect(() => {
    const init = async () => {
      try {
        const [themeId, customResult, directoryInfo] = await Promise.all([
          db.getCurrentTheme().catch(() => getDefaultTheme().id),
          db.getCustomThemes().catch(() => ({ themes: [] as ThemeDefinition[], errors: [] })),
          db.getThemeDirectoryInfo().catch(() => null),
        ]);

        for (const err of customResult.errors) {
          showToast(`自定义主题 "${err.file_name}" 加载失败：${err.error}`, "error");
        }
        loadErrorSignatureRef.current = JSON.stringify(customResult.errors);

        const customs = customResult.themes.map((theme) => normalizeTheme(theme, "custom"));
        customThemesRef.current = customs;
        setCustomThemes(customs);
        if (directoryInfo) {
          setThemeDirectoryInfo(directoryInfo);
        }

        desiredThemeIdRef.current = themeId;
        const theme =
          presetThemes.find((preset) => preset.id === themeId) ??
          customs.find((custom) => custom.id === themeId) ??
          getDefaultTheme();
        setCurrentThemeId(theme.id);
        applyAndBroadcast(theme);
      } catch {
        applyAndBroadcast(getDefaultTheme());
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, [applyAndBroadcast]);

  useEffect(() => {
    const handleAdded = (e: Event) => {
      const theme = normalizeTheme((e as CustomEvent<ThemeDefinition>).detail, "mod");
      const conflictWithPreset = presetThemes.some((t) => t.id === theme.id);
      const conflictWithCustom = customThemesRef.current.some((t) => t.id === theme.id);
      if (conflictWithPreset || conflictWithCustom) {
        const kind = conflictWithPreset ? "内置预设" : "自定义文件";
        showToast(`Mod 主题 ID "${theme.id}" 与${kind}主题冲突，已拒绝加载。`, "error");
        return;
      }

      setModThemes((prev) => {
        const exists = prev.some((t) => t.id === theme.id);
        const next = exists ? prev.map((t) => (t.id === theme.id ? theme : t)) : [...prev, theme];
        if (desiredThemeIdRef.current === theme.id) {
          setCurrentThemeId(theme.id);
          applyAndBroadcast(theme);
        }
        return next;
      });
    };

    const handleRemoved = (e: Event) => {
      const themeId = (e as CustomEvent<string>).detail;
      setModThemes((prev) => prev.filter((theme) => theme.id !== themeId));
      if (desiredThemeIdRef.current === themeId || currentThemeId === themeId) {
        const fallback = getPresetTheme("dark") ?? getDefaultTheme();
        desiredThemeIdRef.current = fallback.id;
        setCurrentThemeId(fallback.id);
        applyAndBroadcast(fallback);
        void db.setCurrentTheme(fallback.id).catch(() => {});
      }
    };

    window.addEventListener(MOD_THEME_ADDED, handleAdded);
    window.addEventListener(MOD_THEME_REMOVED, handleRemoved);
    return () => {
      window.removeEventListener(MOD_THEME_ADDED, handleAdded);
      window.removeEventListener(MOD_THEME_REMOVED, handleRemoved);
    };
  }, [applyAndBroadcast, currentThemeId]);

  const setTheme = useCallback(
    async (themeId: string) => {
      await syncCurrentTheme(themeId, true);
    },
    [syncCurrentTheme],
  );

  const importTheme = useCallback(async (sourcePath: string): Promise<ThemeInstallResult> => {
    const result = await db.installThemeFile(sourcePath);
    for (const issue of result.validation_issues) {
      showToast(`主题 "${result.theme.name}"：${issue.message}`, issue.level);
    }
    await refreshCustomThemes();
    return result;
  }, [refreshCustomThemes]);

  const exportTheme = useCallback(async (theme: ThemeDefinition, targetPath: string): Promise<ThemeExportPayload> => {
    return db.exportThemeFile(toExportableTheme(theme), targetPath);
  }, []);

  return {
    currentTheme,
    availableThemes,
    setTheme,
    loading,
    refreshCustomThemes,
    importTheme,
    exportTheme,
    themeDirectoryInfo,
  };
}

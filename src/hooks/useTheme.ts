import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  ThemeDefinition,
  ThemeDirectoryInfo,
  ThemeExportPayload,
  ThemeInstallResult,
} from "../types/theme";
import {
  presetThemes,
  getDefaultTheme,
  toExportableTheme,
  withDefaultThemeVariables,
} from "../themes";
import { applyTheme } from "../lib/theme";
import { SHAPE_CHANGED_EVENT } from "../themes/shapeLang";
import { notifyThemeChange } from "../lib/modApi";
import { showToast } from "../lib/toast";
import * as db from "../lib/db";

export const MOD_THEME_ADDED = "mod-theme-added";
export const MOD_THEME_REMOVED = "mod-theme-removed";

/** 启动 FOUC 门控超时兜底（毫秒）：到时仍未就绪则强制套用默认主题并放行窗口显示 */
const INIT_TIMEOUT_MS = 2000;

/** 复刻后端 sanitize_theme_file_stem：把主题 id 规整为目录/文件名安全的 stem */
function sanitizeThemeFileStem(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "theme";
}

/**
 * 推导主题包绝对根目录（用于解析 assets/fonts 相对路径）：
 * - custom：目录型主题包(file_name === "theme.json")根目录为 <themes_dir>/<sanitize(id)>，
 *   单文件主题根目录为 <themes_dir>
 * - mod：根目录需由上游注入到 theme.themeRoot（前端无 modId 无法推导）
 * - preset 或缺少目录信息：返回 undefined（内置主题资源为 data:/绝对 URL，无需解析）
 */
function deriveThemeRoot(
  theme: ThemeDefinition,
  dirInfo: ThemeDirectoryInfo | null,
): string | undefined {
  if (theme.themeRoot) return theme.themeRoot;
  if (!dirInfo) return undefined;
  if (theme.source === "custom") {
    const themesDir = dirInfo.themes_dir.replace(/[\\/]+$/, "");
    if (theme.fileName === "theme.json") {
      return `${themesDir}/${sanitizeThemeFileStem(theme.id)}`;
    }
    return themesDir;
  }
  return undefined;
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
  const [activeVariant, setActiveVariantState] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const desiredThemeIdRef = useRef(getDefaultTheme().id);
  // 外部显式意图标记：init 完成前若已有 setTheme（含测试/快捷键等程序化调用），
  // 持久化值不得覆盖该意图——desiredThemeIdRef 是唯一意图来源。
  const hasExternalIntentRef = useRef(false);
  const customThemesRef = useRef<ThemeDefinition[]>([]);
  const loadErrorSignatureRef = useRef("");
  // 以下 ref 用于让 applyAndBroadcast 保持稳定引用的同时读取最新的目录信息与变体
  const themeDirectoryInfoRef = useRef<ThemeDirectoryInfo | null>(null);
  const activeVariantRef = useRef<string | undefined>(undefined);
  // 记录上次已套用的 mod 主题对象，用于判定是否需要重新套用（新增/更新场景）
  const lastAppliedModThemeRef = useRef<ThemeDefinition | null>(null);

  const availableThemes = useMemo(
    () => [
      ...presetThemes.map((theme) => normalizeTheme(theme, "preset")),
      ...customThemes.map((theme) => normalizeTheme(theme, "custom")),
      ...modThemes.map((theme) => normalizeTheme(theme, "mod")),
    ],
    [customThemes, modThemes],
  );

  // 用 ref 同步最新 availableThemes，避免 syncCurrentTheme 的 stale closure
  const availableThemesRef = useRef<ThemeDefinition[]>(availableThemes);
  useEffect(() => {
    availableThemesRef.current = availableThemes;
  }, [availableThemes]);

  // availableThemesRef 由 effect 更新（滞后一拍）；customThemesRef 在 refreshCustomThemes
  // 中随 setCustomThemes 同步更新（领先一拍）。二者并查，修复「importTheme 返回后同一
  // 微任务链里立即 setTheme(新主题)」时渲染尚未 flush、findTheme miss 而错误回退默认
  // 主题并持久化的竞态（回归测试：useTheme.race.test.tsx）。
  const findTheme = useCallback(
    (id: string): ThemeDefinition | undefined =>
      availableThemesRef.current.find((theme) => theme.id === id) ??
      customThemesRef.current.find((theme) => theme.id === id),
    [],
  );

  const currentTheme = useMemo(
    () => findTheme(currentThemeId) ?? getDefaultTheme(),
    [currentThemeId, findTheme],
  );

  const applyAndBroadcast = useCallback((theme: ThemeDefinition) => {
    const normalized = normalizeTheme(theme, theme.source ?? (theme.isPreset ? "preset" : "custom"));
    const themeRoot = deriveThemeRoot(normalized, themeDirectoryInfoRef.current);
    // 仅当当前主题确实声明了该变体时才传入，避免对不含变体的主题误叠加
    const variant =
      activeVariantRef.current && normalized.variants?.[activeVariantRef.current]
        ? activeVariantRef.current
        : undefined;
    applyTheme(normalized, { themeRoot, activeVariant: variant });
    notifyThemeChange(normalized.id);
  }, []);

  const syncCurrentTheme = useCallback(
    async (nextThemeId: string, persist = false) => {
      hasExternalIntentRef.current = true;
      desiredThemeIdRef.current = nextThemeId;
      const theme = findTheme(nextThemeId) ?? getDefaultTheme();
      // 切换主题时重置变体（不同主题的变体名互不通用）
      activeVariantRef.current = undefined;
      setActiveVariantState(undefined);
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

      // 同一批坏文件不重复弹错：签名（错误清单序列化）变化时才 toast
      const errorSignature = JSON.stringify(result.errors);
      if (result.errors.length > 0 && errorSignature !== loadErrorSignatureRef.current) {
        for (const err of result.errors) {
          showToast(`自定义主题 "${err.file_name}" 加载失败：${err.error}`, "error");
        }
      }
      loadErrorSignatureRef.current = errorSignature;

      const themes = result.themes.map((theme) => normalizeTheme(theme, "custom"));
      customThemesRef.current = themes;
      setCustomThemes(themes);
      if (directoryInfo) {
        // 同步更新 ref，确保紧随其后的 applyAndBroadcast 能拿到最新目录信息推导主题根目录
        themeDirectoryInfoRef.current = directoryInfo;
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
    themeDirectoryInfoRef.current = themeDirectoryInfo;
  }, [themeDirectoryInfo]);

  useEffect(() => {
    // settled 守卫：保证「正常初始化」与「超时兜底」二者只生效一次，避免竞态重复套用
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setLoading(false);
    };

    // 超时兜底：若某个 invoke 永久 pending，到时强制套用默认主题并放行窗口显示，避免卡死在不可见状态
    const timer = window.setTimeout(() => {
      if (settled) return;
      applyAndBroadcast(getDefaultTheme());
      finish();
    }, INIT_TIMEOUT_MS);

    const init = async () => {
      try {
        const [themeId, customResult, directoryInfo] = await Promise.all([
          db.getCurrentTheme().catch(() => getDefaultTheme().id),
          db.getCustomThemes().catch(() => ({ themes: [] as ThemeDefinition[], errors: [] })),
          db.getThemeDirectoryInfo().catch(() => null),
        ]);

        // 同一批坏文件不重复弹错：签名变化时才 toast
        const errorSignature = JSON.stringify(customResult.errors);
        if (customResult.errors.length > 0 && errorSignature !== loadErrorSignatureRef.current) {
          for (const err of customResult.errors) {
            showToast(`自定义主题 "${err.file_name}" 加载失败：${err.error}`, "error");
          }
        }
        loadErrorSignatureRef.current = errorSignature;

        // 超时兜底可能已放行 UI（settled=true）：迟到的结果仍补齐状态——自定义主题
        // 与目录信息是无害的状态设置，丢掉会导致本次会话自定义主题整体不可用。
        // 「超时后 UI 不再等待」的语义只由 settled/finish 保证，不影响此处应用。
        const customs = customResult.themes.map((theme) => normalizeTheme(theme, "custom"));
        customThemesRef.current = customs;
        setCustomThemes(customs);
        if (directoryInfo) {
          themeDirectoryInfoRef.current = directoryInfo;
          setThemeDirectoryInfo(directoryInfo);
        }

        // 已有外部意图时以意图为准，持久化值只用于初始化无主意图的场景
        if (!hasExternalIntentRef.current) {
          desiredThemeIdRef.current = themeId;
        }
        const desired = desiredThemeIdRef.current;
        const theme =
          presetThemes.find((preset) => preset.id === desired) ??
          customs.find((custom) => custom.id === desired) ??
          getDefaultTheme();
        setCurrentThemeId(theme.id);
        applyAndBroadcast(theme);
      } catch {
        if (!settled) applyAndBroadcast(getDefaultTheme());
      } finally {
        window.clearTimeout(timer);
        finish();
      }
    };
    void init();

    return () => {
      window.clearTimeout(timer);
    };
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

      // 纯状态更新：是否应用由下方监听 modThemes 的 effect 依据 desiredThemeIdRef 统一决定
      setModThemes((prev) => {
        const exists = prev.some((t) => t.id === theme.id);
        return exists ? prev.map((t) => (t.id === theme.id ? theme : t)) : [...prev, theme];
      });
    };

    const handleRemoved = (e: Event) => {
      const themeId = (e as CustomEvent<string>).detail;
      setModThemes((prev) => prev.filter((theme) => theme.id !== themeId));
      // 以 desiredThemeIdRef 为唯一意图来源：被移除的正是当前意图主题时回退到默认主题
      if (desiredThemeIdRef.current === themeId) {
        const fallback = getDefaultTheme();
        desiredThemeIdRef.current = fallback.id;
        setCurrentThemeId(fallback.id);
        applyAndBroadcast(fallback);
        void db.setCurrentTheme(fallback.id).catch(() => {});
      }
    };

    window.addEventListener(MOD_THEME_ADDED, handleAdded);
    window.addEventListener(MOD_THEME_REMOVED, handleRemoved);

    // 造型风格（A/B 双风格）切换：不重选主题，仅按最新偏好重应用当前主题
    const handleShapeChanged = () => {
      applyAndBroadcast(findTheme(desiredThemeIdRef.current) ?? getDefaultTheme());
    };
    window.addEventListener(SHAPE_CHANGED_EVENT, handleShapeChanged);
    return () => {
      window.removeEventListener(MOD_THEME_ADDED, handleAdded);
      window.removeEventListener(MOD_THEME_REMOVED, handleRemoved);
      window.removeEventListener(SHAPE_CHANGED_EVENT, handleShapeChanged);
    };
  }, [applyAndBroadcast, findTheme]);

  // Mod 主题统一应用：以 desiredThemeIdRef 为唯一意图来源，
  // 当意图指向的 mod 主题在 modThemes 中出现或内容更新时套用（避免在 updater 内调用 setState 的反模式）。
  useEffect(() => {
    const desired = desiredThemeIdRef.current;
    const target = modThemes.find((t) => t.id === desired);
    if (!target) {
      lastAppliedModThemeRef.current = null;
      return;
    }
    if (lastAppliedModThemeRef.current === target) return; // 引用未变，无需重套
    lastAppliedModThemeRef.current = target;
    setCurrentThemeId(target.id);
    applyAndBroadcast(target);
  }, [modThemes, applyAndBroadcast]);

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

  const setActiveVariant = useCallback(
    (variant: string | undefined) => {
      // 仅在当前主题确实声明了该变体时才生效；空值表示恢复无变体
      const next = variant && currentTheme.variants?.[variant] ? variant : undefined;
      activeVariantRef.current = next;
      setActiveVariantState(next);
      applyAndBroadcast(currentTheme);
    },
    [applyAndBroadcast, currentTheme],
  );

  return {
    currentTheme,
    availableThemes,
    setTheme,
    loading,
    refreshCustomThemes,
    importTheme,
    exportTheme,
    themeDirectoryInfo,
    activeVariant,
    setActiveVariant,
  };
}

// ============================================================================
// components/ThemeFamilyGallery.tsx — 设置里官方四族的主选择器
// ----------------------------------------------------------------------------
// 预览卡即选择器：每张卡用该族当前亮/暗主题的真实变量画小工作台，点卡
// setTheme(resolveFamilyThemeId(family, mode))。当前主题若是自定义/Mod，
// 四卡都不勾。
// ============================================================================

import { type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { ResolvedColorMode } from "../lib/colorMode";
import {
  THEME_FAMILIES,
  findFamilyByThemeId,
  getPresetTheme,
  resolveFamilyThemeId,
  type ThemeFamily,
} from "../themes";
import type { ThemeDefinition } from "../types/theme";

function familyTheme(themes: ThemeDefinition[], family: ThemeFamily, mode: ResolvedColorMode): ThemeDefinition | undefined {
  const id = resolveFamilyThemeId(family, mode);
  return themes.find((entry) => entry.id === id) ?? getPresetTheme(id);
}

export function ThemeFamilyGallery({
  themes,
  currentThemeId,
  effectiveMode,
  onSelect,
}: {
  themes: ThemeDefinition[];
  currentThemeId: string;
  effectiveMode: ResolvedColorMode;
  onSelect: (id: string) => Promise<void>;
}) {
  const selectedFamily = findFamilyByThemeId(currentThemeId);
  const tabbableId = selectedFamily?.id ?? THEME_FAMILIES[0]?.id;

  const applyFamily = (family: ThemeFamily) => {
    void onSelect(resolveFamilyThemeId(family, effectiveMode));
    requestAnimationFrame(() => {
      document.getElementById(`theme-family-gallery-${family.id}`)?.focus();
    });
  };

  const onFamilyKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = THEME_FAMILIES.length - 1;
    const offset =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (offset) {
      event.preventDefault();
      const next = THEME_FAMILIES[(index + offset + THEME_FAMILIES.length) % THEME_FAMILIES.length];
      if (next) applyFamily(next);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      if (THEME_FAMILIES[0]) applyFamily(THEME_FAMILIES[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      if (THEME_FAMILIES[last]) applyFamily(THEME_FAMILIES[last]);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const family = THEME_FAMILIES[index];
      if (family) applyFamily(family);
    }
  };

  return (
    <section className="min-w-0 flex-1">
      <h4 className="text-sm font-medium text-[var(--text-primary)]">官方配色</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">点选立即应用。缩略用该族当前亮暗的真实纸色。</p>
      <div
        role="radiogroup"
        aria-label="官方配色"
        data-theme-family-gallery=""
        className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        {THEME_FAMILIES.map((family, index) => {
          const theme = familyTheme(themes, family, effectiveMode);
          if (!theme) return null;
          const colors = theme.variables;
          const tagColors = colors["tag-preset-colors"].split(",");
          const selected = selectedFamily?.id === family.id;
          const radius = family.lang === "b" ? "2px" : "8px";
          return (
            <button
              key={family.id}
              id={`theme-family-gallery-${family.id}`}
              type="button"
              role="radio"
              aria-label={family.name}
              aria-checked={selected}
              tabIndex={family.id === tabbableId ? 0 : -1}
              onClick={() => applyFamily(family)}
              onKeyDown={(event) => onFamilyKeyDown(event, index)}
              className="theme-choice min-w-0 overflow-hidden rounded-[var(--radius-lg)] border p-2 text-left"
            >
              <span
                aria-hidden="true"
                className="flex h-24 overflow-hidden border p-1"
                style={{
                  background: colors["bg-surface"],
                  borderColor: colors["border-default"],
                  borderRadius: radius,
                }}
              >
                <span
                  className="mr-1.5 flex w-8 shrink-0 flex-col gap-1 p-1"
                  style={{
                    background: colors["bg-base"],
                    borderColor: colors["border-default"],
                  }}
                >
                  <span className="h-1 w-4" style={{ background: colors["accent-primary"] }} />
                  <span className="h-1 w-5 opacity-60" style={{ background: colors["text-secondary"] }} />
                  <span className="h-1 w-3.5 opacity-60" style={{ background: colors["text-secondary"] }} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-h-0 flex-1 gap-1">
                    {[0, 1].map((card) => (
                      <span
                        key={card}
                        className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1"
                      >
                        <span className="h-4 w-4 rounded-sm" style={{ background: colors["bg-hover"] }} />
                        <span className="h-1 w-4/5 opacity-70" style={{ background: colors["text-primary"] }} />
                        <span className="h-1 w-1/2 opacity-45" style={{ background: colors["text-secondary"] }} />
                        <span className="h-2 w-4/5 rounded-sm" style={{ background: `color-mix(in srgb, ${tagColors[card]} 20%, ${colors["bg-surface"]})` }} />
                      </span>
                    ))}
                  </span>
                  <span className="flex gap-1">
                    {tagColors.map((color) => <span key={color} className="h-1.5 min-w-0 flex-1 rounded-sm" style={{ background: color }} />)}
                  </span>
                </span>
              </span>
              <span className="mt-2 flex items-center justify-between gap-1 px-0.5 text-[13px] font-medium">
                <span className="truncate">{family.name}</span>
                {selected && <Check size={14} strokeWidth={2} aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

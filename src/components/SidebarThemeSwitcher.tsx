// ============================================================================
// components/SidebarThemeSwitcher.tsx — 首页侧栏底部官方主题色点与亮/暗分段
// ----------------------------------------------------------------------------
// 色点列出全部官方配色家族，代表色取该家族亮色 accent；点击后套用该家族在
// 当前亮/暗下的主题 id。亮/暗分段写入显式 light/dark（离开跟随系统）。
// 当前主题不属于官方家族时，亮/暗分段禁用，避免改写自定义/Mod 配色。
// 套用与持久化走 useTheme 的 setTheme / changeColorMode。
// ============================================================================

import { type KeyboardEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { findFamilyByThemeId, listOfficialFamilySwatches } from "../themes";
import { useThemeContextOptional } from "./ThemeProvider";

export function SidebarThemeSwitcher() {
  const themeContext = useThemeContextOptional();
  if (!themeContext) return null;

  const { currentTheme, setTheme, effectiveMode, changeColorMode } = themeContext;
  const currentFamily = findFamilyByThemeId(currentTheme.id);
  const swatches = listOfficialFamilySwatches(effectiveMode);
  const modeToggleEnabled = currentFamily !== undefined;
  const selectedFamilyId = currentFamily?.id;

  const applyFamilyAt = (index: number) => {
    const swatch = swatches[index];
    if (!swatch) return;
    void setTheme(swatch.themeId);
    requestAnimationFrame(() => {
      document.getElementById(`sidebar-theme-family-${swatch.id}`)?.focus();
    });
  };

  const onFamilyKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = swatches.length - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      applyFamilyAt(index === last ? 0 : index + 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      applyFamilyAt(index === 0 ? last : index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      applyFamilyAt(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      applyFamilyAt(last);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      applyFamilyAt(index);
    }
  };

  const applyMode = (mode: "light" | "dark") => {
    if (!modeToggleEnabled) return;
    changeColorMode(mode);
    requestAnimationFrame(() => {
      document.getElementById(`sidebar-theme-mode-${mode}`)?.focus();
    });
  };

  const onModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, mode: "light" | "dark") => {
    if (!modeToggleEnabled) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      applyMode("dark");
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      applyMode("light");
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      applyMode("light");
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      applyMode("dark");
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      applyMode(mode);
    }
  };

  const tabbableFamilyId =
    selectedFamilyId ?? swatches[0]?.id;
  const lightSelected = effectiveMode === "light";
  const darkSelected = effectiveMode === "dark";

  return (
    <div
      data-region="sidebar-theme"
      className="flex shrink-0 flex-col gap-2.5 border-t border-[var(--line-hairline)] px-3 py-2.5"
    >
      <div
        role="radiogroup"
        aria-label="官方主题"
        className="flex items-center justify-between"
      >
        {swatches.map((swatch, index) => {
          const selected = swatch.id === selectedFamilyId;
          return (
            <button
              key={swatch.id}
              id={`sidebar-theme-family-${swatch.id}`}
              type="button"
              role="radio"
              aria-label={swatch.name}
              aria-checked={selected}
              title={swatch.name}
              tabIndex={swatch.id === tabbableFamilyId ? 0 : -1}
              onClick={() => void setTheme(swatch.themeId)}
              onKeyDown={(event) => onFamilyKeyDown(event, index)}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:z-10"
            >
              <span
                aria-hidden="true"
                className={`rounded-full ring-1 ring-[color-mix(in_srgb,var(--border-strong)_42%,transparent)] transition-[transform,box-shadow] ${
                  selected ? "h-4 w-4" : "h-3.5 w-3.5"
                }`}
                style={{
                  backgroundColor: swatch.swatchColor,
                  boxShadow: selected
                    ? `0 0 0 2px var(--bg-surface), 0 0 0 3.5px ${swatch.swatchColor}`
                    : undefined,
                }}
              />
            </button>
          );
        })}
      </div>

      <div
        role="radiogroup"
        aria-label="外观模式"
        aria-disabled={!modeToggleEnabled}
        title={
          modeToggleEnabled
            ? "切换亮色或暗色"
            : "当前主题自带配色，亮/暗切换仅对内置主题生效"
        }
        className="flex h-9 w-full items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-recessed)] p-0.5"
      >
        <button
          id="sidebar-theme-mode-light"
          type="button"
          role="radio"
          aria-label="亮色"
          aria-checked={lightSelected}
          title="亮色"
          disabled={!modeToggleEnabled}
          tabIndex={modeToggleEnabled && lightSelected ? 0 : modeToggleEnabled && !darkSelected ? 0 : -1}
          onClick={() => applyMode("light")}
          onKeyDown={(event) => onModeKeyDown(event, "light")}
          className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-full transition-colors ${
            lightSelected
              ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-muted)]`}
        >
          <Sun className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          id="sidebar-theme-mode-dark"
          type="button"
          role="radio"
          aria-label="暗色"
          aria-checked={darkSelected}
          title="暗色"
          disabled={!modeToggleEnabled}
          tabIndex={modeToggleEnabled && darkSelected ? 0 : -1}
          onClick={() => applyMode("dark")}
          onKeyDown={(event) => onModeKeyDown(event, "dark")}
          className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-full transition-colors ${
            darkSelected
              ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-muted)]`}
        >
          <Moon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

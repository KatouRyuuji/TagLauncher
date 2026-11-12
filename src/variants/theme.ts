import { THEME_FAMILIES, getPresetTheme } from "../themes";
import { applyTheme } from "../lib/theme";
import { applyUiFontScale, type UiFontScale } from "../lib/uiFontScale";

export type ColorMode = "light" | "dark";

export function applyVariantTheme(mode: ColorMode, font: UiFontScale = 1): void {
  const family = THEME_FAMILIES[0]; // 霜靛
  const theme = getPresetTheme(mode === "dark" ? family.dark : family.light);
  if (!theme) throw new Error("霜靛主题未找到");
  applyTheme(theme);
  const root = document.documentElement;
  root.setAttribute("data-color-mode", mode);
  root.style.colorScheme = mode;
  applyUiFontScale(font);
  document.body.style.fontFamily = "var(--font-family)";
  document.body.style.fontSize = "calc(var(--font-size-base) * var(--ui-font-scale, 1))";
  document.body.style.color = "var(--text-primary)";
  document.body.style.background = "transparent";
}

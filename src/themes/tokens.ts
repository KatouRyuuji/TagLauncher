import type { ThemeDefinition } from "../types/theme";
import { ryuujiThemes } from "./ryuuji";

// 规范默认变量集：取自工厂生成的霜靛·暗（A 纸面暗色，键集完整）。
const canonicalTheme =
  ryuujiThemes.find((theme) => theme.id === "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93") ?? ryuujiThemes[0];

export const THEME_VARIABLE_KEYS = Object.keys(canonicalTheme.variables).sort();

export const DEFAULT_THEME_VARIABLES = canonicalTheme.variables;

export function withDefaultThemeVariables(theme: ThemeDefinition): ThemeDefinition {
  return {
    ...theme,
    variables: {
      ...DEFAULT_THEME_VARIABLES,
      ...theme.variables,
    },
  };
}

export function toExportableTheme(theme: ThemeDefinition): ThemeDefinition {
  const {
    source: _source,
    fileName: _fileName,
    isPreset: _isPreset,
    themeRoot: _themeRoot,
    ...rest
  } = theme;
  return {
    ...rest,
    isPreset: false,
  };
}

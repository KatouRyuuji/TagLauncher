import type { ThemeDefinition } from "../types/theme";
import { darkTheme } from "./dark";

export const THEME_VARIABLE_KEYS = Object.keys(darkTheme.variables).sort();

export const DEFAULT_THEME_VARIABLES = darkTheme.variables;

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

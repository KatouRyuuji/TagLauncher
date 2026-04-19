import type { ThemeDefinition, ThemeValidationIssue } from "../types/theme";
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

export function validateThemeContract(theme: ThemeDefinition): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  for (const key of THEME_VARIABLE_KEYS) {
    if (!(key in theme.variables)) {
      issues.push({
        level: "warning",
        message: `缺少推荐变量 "${key}"，将使用默认主题值兜底`,
      });
    }
  }
  return issues;
}

export function toExportableTheme(theme: ThemeDefinition): ThemeDefinition {
  const { source: _source, fileName: _fileName, isPreset: _isPreset, ...rest } = theme;
  return {
    ...rest,
    isPreset: false,
  };
}

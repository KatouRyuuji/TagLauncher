import type { ThemeDefinition } from "../types/theme";
import { ryuujiThemes } from "./ryuuji";

// 规范默认变量集：取自工厂生成的霜靛·暗（A 纸面暗色，键集完整）。
const canonicalTheme =
  ryuujiThemes.find((theme) => theme.id === "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93") ?? ryuujiThemes[0];

export const THEME_VARIABLE_KEYS = Object.keys(canonicalTheme.variables).sort();

// 规范主题是霜靛·暗，暗色板把标签胶囊 alpha 加实；缺省补齐仍用亮色配方，
// 避免不完整的自定义亮色主题吃到 30% 实底。
export const DEFAULT_THEME_VARIABLES: Record<string, string> = {
  ...canonicalTheme.variables,
  "tag-color-alpha": "9%",
  "tag-selected-alpha": "16%",
  "tag-muted-alpha": "9%",
};

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

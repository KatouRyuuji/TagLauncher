import type { ThemeDefinition } from "../types/theme";
import { darkTheme } from "./dark";
import { sakuraTheme } from "./sakura";
import { cyberCyanTheme } from "./cyber-cyan";
import { ryuujiThemes } from "./ryuuji";
export {
  DEFAULT_THEME_VARIABLES,
  THEME_VARIABLE_KEYS,
  toExportableTheme,
  withDefaultThemeVariables,
} from "./tokens";

// 内置主题 = 3 个历史主题（sakura=A1亮 / dark=A2暗 / cyber-cyan=B2暗，id 已被用户配置持久化）
// + RyuujiDesign 锁定色板工厂生成的其余 17 套（见 ./ryuuji.ts 头部注释）
export const presetThemes: ThemeDefinition[] = [darkTheme, sakuraTheme, cyberCyanTheme, ...ryuujiThemes].map((theme) => ({
  ...theme,
  isPreset: true,
  source: "preset",
}));

export function getPresetTheme(id: string): ThemeDefinition | undefined {
  return presetThemes.find((t) => t.id === id);
}

export function getDefaultTheme(): ThemeDefinition {
  return presetThemes[0];
}

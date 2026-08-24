import type { ThemeDefinition } from "../types/theme";
import { darkTheme } from "./dark";
import { sakuraTheme } from "./sakura";
import { cyberCyanTheme } from "./cyber-cyan";
export {
  DEFAULT_THEME_VARIABLES,
  THEME_VARIABLE_KEYS,
  toExportableTheme,
  withDefaultThemeVariables,
} from "./tokens";

export const presetThemes: ThemeDefinition[] = [darkTheme, sakuraTheme, cyberCyanTheme].map((theme) => ({
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

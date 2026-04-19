import type { ThemeDefinition } from "../types/theme";
import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import { sakuraTheme } from "./sakura";
export {
  DEFAULT_THEME_VARIABLES,
  THEME_VARIABLE_KEYS,
  toExportableTheme,
  validateThemeContract,
  withDefaultThemeVariables,
} from "./tokens";

export const presetThemes: ThemeDefinition[] = [darkTheme, lightTheme, sakuraTheme].map((theme) => ({
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

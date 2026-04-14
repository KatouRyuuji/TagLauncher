import type { ThemeDefinition } from "../types/theme";
import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import { sakuraTheme } from "./sakura";

export const presetThemes: ThemeDefinition[] = [darkTheme, lightTheme, sakuraTheme];

export function getPresetTheme(id: string): ThemeDefinition | undefined {
  return presetThemes.find((t) => t.id === id);
}

export function getDefaultTheme(): ThemeDefinition {
  return darkTheme;
}

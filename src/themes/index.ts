import type { ThemeDefinition } from "../types/theme";
import type { ResolvedColorMode } from "../lib/colorMode";
import { getColorMode, resolveColorMode } from "../lib/colorMode";
import { sakuraTheme } from "./sakura";
import { ryuujiThemes } from "./ryuuji";
import type { ShapeLang } from "./shapeLang";
export {
  DEFAULT_THEME_VARIABLES,
  THEME_VARIABLE_KEYS,
  toExportableTheme,
  withDefaultThemeVariables,
} from "./tokens";

// 内置主题 = 历史主题 sakura（A1 亮，id 已被用户配置持久化）
// + RyuujiDesign 锁定色板工厂生成的 13 套（见 ./ryuuji.ts 头部注释）
export const presetThemes: ThemeDefinition[] = [sakuraTheme, ...ryuujiThemes].map((theme) => ({
  ...theme,
  isPreset: true,
  source: "preset",
}));

/**
 * 配色家族注册表（主题模型：家族 × 亮/暗模式）。
 * 主题选择器以家族为粒度展示；亮/暗由独立开关决定，解析到家族对应的具体主题 id。
 */
export interface ThemeFamily {
  id: string;
  name: string;
  lang: ShapeLang;
  /** 亮色模式对应的主题 id */
  light: string;
  /** 暗色模式对应的主题 id */
  dark: string;
}

export const THEME_FAMILIES: ThemeFamily[] = [
  { id: "a1", name: "霜靛", lang: "a", light: "7f47aab2-74bb-4c77-b99b-550f0acf3c9c", dark: "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93" },
  { id: "a3", name: "藤色", lang: "a", light: "668e5856-9d9f-481a-8f82-325372d2e256", dark: "65596bf6-3aaf-4322-93f2-bbb60cb94b5d" },
  { id: "a4", name: "柳染", lang: "a", light: "3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2", dark: "cd4665e5-081f-434b-943f-bd44b49cd6ac" },
  { id: "a5", name: "水浅葱", lang: "a", light: "6794e521-fd01-4e6d-997a-c4d0f1c66de2", dark: "f2368e2a-ee19-4192-96ea-3db85f15c74d" },
  { id: "a6", name: "樱花", lang: "a", light: "70492696-751c-4a29-9ab4-09ad8ddff1a4", dark: "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a" },
  { id: "b1", name: "海军冰蓝", lang: "b", light: "e0f5add7-8b67-42c9-9b2b-c7bbf49e255d", dark: "6c309a70-ec6a-4429-8299-c4cde7c0ffcc" },
  { id: "b3", name: "铁锈", lang: "b", light: "5298ac16-455f-42f8-8bc8-e9b03ee0fdbf", dark: "cfaadcb4-7e85-460c-a8fe-52e848959719" },
];

/** 主题 id 所属的配色家族；自定义/Mod 主题不属于任何家族时返回 undefined */
export function findFamilyByThemeId(themeId: string): ThemeFamily | undefined {
  return THEME_FAMILIES.find((family) => family.light === themeId || family.dark === themeId);
}

/** 家族 + 模式 → 具体主题 id */
export function resolveFamilyThemeId(family: ThemeFamily, mode: ResolvedColorMode): string {
  return mode === "dark" ? family.dark : family.light;
}

/** 默认家族：霜靛（默认主题 = 默认家族按当前模式解析） */
export const DEFAULT_FAMILY = THEME_FAMILIES[0];

export function getPresetTheme(id: string): ThemeDefinition | undefined {
  return presetThemes.find((t) => t.id === id);
}

/** 默认主题：霜靛家族，亮暗跟随当前模式偏好（未设置时跟随系统） */
export function getDefaultTheme(mode: ResolvedColorMode = resolveColorMode(getColorMode())): ThemeDefinition {
  return getPresetTheme(resolveFamilyThemeId(DEFAULT_FAMILY, mode)) ?? presetThemes[0];
}

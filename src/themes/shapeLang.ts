// ============================================================================
// themes/shapeLang.ts — 工作台结构令牌
// ----------------------------------------------------------------------------
// 结构令牌集中维护字号、间距、圆角、阴影和动效，亮暗模式共享同一套层级。
// UI 与长文均使用 Noto Sans SC；路径与技术信息使用 Cascadia Code。
// ============================================================================

import type { ThemeDefinition } from "../types/theme";

export type ShapeLang = "a" | "b";
export type ShapeScheme = "light" | "dark";

// UI 与等宽字体的本地打包形态：
// @fontsource-variable 注册 "Noto Sans SC Variable"（可变字重），
// @fontsource 注册 "Cascadia Code"；其后为系统字体兜底。
const FONT_UI = "\"Noto Sans SC Variable\", \"Noto Sans SC\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"MiSans\", system-ui, -apple-system, \"Segoe UI\", sans-serif";
const FONT_MONO = "\"Cascadia Code\", \"Cascadia Mono\", \"JetBrains Mono\", \"Fira Code\", Consolas, \"Courier New\", monospace";

const EASE_A = "cubic-bezier(0.2, 0.72, 0.2, 1)";

/** 共享原语：字号阶梯、空间 4px 原子、侧栏 232 */
const SHARED_TOKENS: Record<string, string> = {
  "font-family": FONT_UI,
  "font-family-mono": FONT_MONO,
  "font-size-xs": "12px",
  "font-size-sm": "13px",
  "font-size-base": "14px",
  "font-size-lg": "16px",
  "font-size-xl": "18px",
  "font-weight-normal": "400",
  "font-weight-medium": "500",
  "font-weight-semibold": "600",
  "font-weight-bold": "700",
  "line-height-tight": "1.3",
  "line-height-normal": "1.6",
  "letter-spacing": "0",
  "spacing-unit": "4px",
  "spacing-xs": "4px",
  "spacing-sm": "8px",
  "spacing-md": "12px",
  "spacing-lg": "16px",
  "spacing-xl": "24px",
  "sidebar-width": "240px",
  "radius-full": "999px",
};

/** 主题结构映射保留类型兼容；官方主题共享一套尺寸与节奏。 */
const LANG_TOKENS: Record<ShapeLang, Record<string, string>> = {
  a: {
    "font-family-body": FONT_UI,
    "radius-sm": "5px",
    "radius-md": "8px",
    "radius-lg": "12px",
    "radius-xl": "16px",
    "radius-2xl": "20px",
    "radius-3xl": "24px",
    // 输入静息纸槽影（paper-well；B 机械面无槽影）
    "shadow-well": "inset 0 1px 1px rgb(26 31 36 / 0.04)",
    // 输入焦点环：tokens.css --sys-shadow-focus（控件本体）；容器外环 4px/12% 见 index.css .field
    "shadow-focus": "0 0 0 3px color-mix(in srgb, var(--accent-primary) 18%, transparent)",
    "transition-fast": `180ms ${EASE_A}`,
    "transition-normal": `240ms ${EASE_A}`,
    "transition-slow": `400ms ${EASE_A}`,
  },
  b: {
    "font-family-body": FONT_UI,
    "radius-sm": "5px",
    "radius-md": "8px",
    "radius-lg": "12px",
    "radius-xl": "16px",
    "radius-2xl": "20px",
    "radius-3xl": "24px",
    "shadow-well": "none",
    "shadow-focus": "none",
    "transition-fast": `180ms ${EASE_A}`,
    "transition-normal": `240ms ${EASE_A}`,
    "transition-slow": `400ms ${EASE_A}`,
  },
};

/** 亮暗主题共享中性描边阶梯。 */
const HAIRLINE_TOKENS: Record<ShapeLang, Record<ShapeScheme, Record<string, string>>> = {
  a: {
    light: {
      "border-subtle": "color-mix(in srgb, var(--text-primary) 13%, transparent)",
      "border-medium": "color-mix(in srgb, var(--text-primary) 24%, transparent)",
    },
    dark: {
      "border-subtle": "color-mix(in srgb, var(--border-default) 88%, var(--text-primary) 12%)",
      "border-medium": "color-mix(in srgb, var(--border-default) 76%, var(--text-primary) 24%)",
    },
  },
  b: { light: {}, dark: {} },
};

/** 阴影随亮暗切换明度，卡片和浮层保持单层分离感。 */
const SHADOW_TOKENS: Record<ShapeLang, Record<ShapeScheme, Record<string, string>>> = {
  a: {
    light: {
      "shadow-sm": "0 1px 2px rgb(25 32 40 / 0.04)",
      "shadow-md": "0 3px 10px rgb(25 32 40 / 0.07)",
      "shadow-lg": "0 8px 24px rgb(25 32 40 / 0.1)",
      "shadow-lift": "0 2px 8px rgb(25 32 40 / 0.08)",
      "shadow-overlay": "0 12px 36px rgb(25 32 40 / 0.16)",
      "shadow-dropdown": "0 6px 20px rgb(25 32 40 / 0.12)",
      "shadow-card": "0 1px 2px rgb(25 32 40 / 0.035)",
      "shadow-glow": "none",
    },
    dark: {
      "shadow-sm": "0 1px 2px rgb(0 0 0 / 0.18)",
      "shadow-md": "0 3px 10px rgb(0 0 0 / 0.22)",
      "shadow-lg": "0 8px 24px rgb(0 0 0 / 0.28)",
      "shadow-lift": "0 2px 8px rgb(0 0 0 / 0.22)",
      "shadow-overlay": "0 12px 36px rgb(0 0 0 / 0.42)",
      "shadow-dropdown": "0 6px 20px rgb(0 0 0 / 0.32)",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.12)",
      "shadow-glow": "none",
    },
  },
  b: {
    light: {
      "shadow-sm": "0 1px 2px rgb(25 32 40 / 0.04)",
      "shadow-md": "0 3px 10px rgb(25 32 40 / 0.07)",
      "shadow-lg": "0 8px 24px rgb(25 32 40 / 0.1)",
      "shadow-lift": "0 2px 8px rgb(25 32 40 / 0.08)",
      "shadow-overlay": "0 12px 36px rgb(25 32 40 / 0.16)",
      "shadow-dropdown": "0 6px 20px rgb(25 32 40 / 0.12)",
      "shadow-card": "0 1px 2px rgb(25 32 40 / 0.035)",
      "shadow-glow": "none",
    },
    dark: {
      "shadow-sm": "0 1px 2px rgb(0 0 0 / 0.18)",
      "shadow-md": "0 3px 10px rgb(0 0 0 / 0.22)",
      "shadow-lg": "0 8px 24px rgb(0 0 0 / 0.28)",
      "shadow-lift": "0 2px 8px rgb(0 0 0 / 0.22)",
      "shadow-overlay": "0 12px 36px rgb(0 0 0 / 0.42)",
      "shadow-dropdown": "0 6px 20px rgb(0 0 0 / 0.32)",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.12)",
      "shadow-glow": "none",
    },
  },
};

/** 指定语言 × 亮暗的完整结构令牌集（共享原语 + 语言分叉 + 发丝边 + 阴影配方）。 */
export function shapeLangTokens(lang: ShapeLang, scheme: ShapeScheme): Record<string, string> {
  return { ...SHARED_TOKENS, ...LANG_TOKENS[lang], ...HAIRLINE_TOKENS[lang][scheme], ...SHADOW_TOKENS[lang][scheme] };
}

/** 从主题 css 推断亮暗（内置/示例主题均显式声明 color-scheme）。 */
export function inferThemeScheme(theme: ThemeDefinition): ShapeScheme {
  return /color-scheme:\s*dark/.test(theme.css ?? "") ? "dark" : "light";
}

/** 主题的造型语言：由主题自身声明（未声明按 A 纸面）。 */
export function resolveShapeLang(theme: ThemeDefinition): ShapeLang {
  return theme.lang ?? "a";
}

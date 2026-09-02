// ============================================================================
// themes/shapeLang.ts — RyuujiDesign 造型语言层（A 纸面 / B 仪表）严格令牌
// ----------------------------------------------------------------------------
// 结构令牌逐值取自 RyuujiDesign styles/{tokens.css, lang/a.css, lang/b.css}：
//   共享原语（字号阶梯/空间阶梯/时长阶梯/字体族）→ tokens.css
//   字重阶梯 400/500/600/700（v6.1 令牌化）
//   A 纸面：圆角 4/8/8/12、缓动 cubic-bezier(0.2,0.72,0.2,1)、Linea 双层软影、
//           发丝边 color-mix(text 13%/24%)、浮层签名影 0 26px 70px -46px
//   B 仪表：圆角 0/2/4/4、硬影 0 1px 0 0、缓动 cubic-bezier(0.25,0.8,0.25,1)
// 色值中间档一律用 var() 引用的 color-mix，不做具体色假设，因此同一份令牌
// 既能烘焙进主题文件，也能在运行时作为「造型风格」覆盖注入（见 lib/theme.ts
// applyTheme 末尾的 applyShapeLang）。
// ============================================================================

import type { ThemeDefinition } from "../types/theme";

export type ShapeLang = "a" | "b";
export type ShapeScheme = "light" | "dark";
/** 造型风格偏好：theme = 跟随主题自身语言；a/b = 强制覆盖结构令牌（保留配色） */
export type ShapePreference = "theme" | ShapeLang;

// --sys-font-ui / --sys-font-mono（tokens.css v5.2：全面 MiSans，旧族兜底）
const FONT_UI = "\"MiSans\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"Noto Sans SC\", system-ui, -apple-system, \"Segoe UI\", sans-serif";
const FONT_MONO = "\"MiSans\", \"Cascadia Code\", \"Cascadia Mono\", \"JetBrains Mono\", \"Fira Code\", Consolas, \"Courier New\", monospace";

const EASE_A = "cubic-bezier(0.2, 0.72, 0.2, 1)"; // lang/a.css（Linea 实测）
const EASE_B = "cubic-bezier(0.25, 0.8, 0.25, 1)"; // tokens.css --sys-ease-smooth

/** tokens.css 共享原语：字号 9 档取前 5、空间 4px 原子 8 级、侧栏 232 */
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
  "sidebar-width": "232px",
  "radius-full": "999px",
};

/** 语言分叉：圆角档（a.css §v5 对档 / b.css §v3.4）、发丝边（A 专有）、缓动 */
const LANG_TOKENS: Record<ShapeLang, Record<string, string>> = {
  a: {
    "radius-sm": "4px",
    "radius-md": "8px",
    "radius-lg": "8px",
    "radius-xl": "12px",
    "border-subtle": "color-mix(in srgb, var(--text-primary) 13%, transparent)",
    "border-medium": "color-mix(in srgb, var(--text-primary) 24%, transparent)",
    "transition-fast": `180ms ${EASE_A}`,
    "transition-normal": `240ms ${EASE_A}`,
    "transition-slow": `400ms ${EASE_A}`,
  },
  b: {
    "radius-sm": "0px",
    "radius-md": "2px",
    "radius-lg": "4px",
    "radius-xl": "4px",
    "transition-fast": `180ms ${EASE_B}`,
    "transition-normal": `240ms ${EASE_B}`,
    "transition-slow": `400ms ${EASE_B}`,
  },
};

/** 阴影配方（a.css v3.4 §2-3 Linea 双层软影 + v3.5 签名浮层影；b.css v3.4 硬影） */
const SHADOW_TOKENS: Record<ShapeLang, Record<ShapeScheme, Record<string, string>>> = {
  a: {
    light: {
      "shadow-sm": "0 1px 2px rgb(26 31 36 / 0.06), 0 8px 24px rgb(26 31 36 / 0.06)",
      "shadow-md": "0 2px 4px rgb(26 31 36 / 0.07), 0 12px 32px rgb(26 31 36 / 0.08)",
      "shadow-lg": "0 2px 6px rgb(26 31 36 / 0.08), 0 16px 40px rgb(26 31 36 / 0.1)",
      "shadow-overlay": "0 26px 70px -46px color-mix(in srgb, var(--text-primary) 46%, transparent)",
      "shadow-dropdown": "0 2px 4px rgb(26 31 36 / 0.07), 0 12px 32px rgb(26 31 36 / 0.08)",
      "shadow-card": "0 1px 2px rgb(26 31 36 / 0.06), 0 8px 24px rgb(26 31 36 / 0.06)",
      "shadow-glow": "none",
    },
    dark: {
      "shadow-sm": "0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.24)",
      "shadow-md": "0 2px 4px rgb(0 0 0 / 0.34), 0 12px 32px rgb(0 0 0 / 0.28)",
      "shadow-lg": "0 2px 6px rgb(0 0 0 / 0.38), 0 16px 40px rgb(0 0 0 / 0.32)",
      "shadow-overlay": "0 26px 70px -46px rgb(0 0 0 / 0.55)",
      "shadow-dropdown": "0 2px 4px rgb(0 0 0 / 0.34), 0 12px 32px rgb(0 0 0 / 0.28)",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.24)",
      "shadow-glow": "none",
    },
  },
  b: {
    light: {
      "shadow-sm": "0 1px 0 0 rgb(18 32 40 / 0.06)",
      "shadow-md": "0 1px 0 0 rgb(18 32 40 / 0.06), 0 2px 4px -2px rgb(18 32 40 / 0.08)",
      "shadow-lg": "0 2px 6px -2px rgb(18 32 40 / 0.1)",
      "shadow-overlay": "0 2px 6px -2px rgb(18 32 40 / 0.1)",
      "shadow-dropdown": "0 1px 0 0 rgb(18 32 40 / 0.06), 0 2px 4px -2px rgb(18 32 40 / 0.08)",
      "shadow-card": "0 1px 0 0 rgb(18 32 40 / 0.06)",
      "shadow-glow": "none",
    },
    dark: {
      "shadow-sm": "0 1px 0 0 rgb(0 0 0 / 0.3)",
      "shadow-md": "0 1px 0 0 rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.35)",
      "shadow-lg": "0 2px 6px -2px rgb(0 0 0 / 0.4)",
      "shadow-overlay": "0 2px 6px -2px rgb(0 0 0 / 0.4)",
      "shadow-dropdown": "0 1px 0 0 rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.35)",
      "shadow-card": "0 1px 0 0 rgb(0 0 0 / 0.3)",
      "shadow-glow": "none",
    },
  },
};

/** 指定语言 × 亮暗的完整结构令牌集（共享原语 + 语言分叉 + 阴影配方）。 */
export function shapeLangTokens(lang: ShapeLang, scheme: ShapeScheme): Record<string, string> {
  return { ...SHARED_TOKENS, ...LANG_TOKENS[lang], ...SHADOW_TOKENS[lang][scheme] };
}

// ---- 造型风格偏好（localStorage；视图偏好同款持久化思路） ----

export const SHAPE_PREF_KEY = "taglauncher.shape-lang";
/** 风格切换后由 SettingsPanel 派发、useTheme 监听以重应用当前主题 */
export const SHAPE_CHANGED_EVENT = "taglauncher:shape-lang-changed";

export function getShapePreference(): ShapePreference {
  try {
    const raw = localStorage.getItem(SHAPE_PREF_KEY);
    return raw === "a" || raw === "b" ? raw : "theme";
  } catch {
    return "theme";
  }
}

export function setShapePreference(pref: ShapePreference): void {
  try {
    localStorage.setItem(SHAPE_PREF_KEY, pref);
  } catch {
    // 隐私模式等场景写入失败时退化为会话内生效（事件仍会派发）
  }
}

/** 从主题 css 推断亮暗（内置/示例主题均显式声明 color-scheme）。 */
export function inferThemeScheme(theme: ThemeDefinition): ShapeScheme {
  return /color-scheme:\s*dark/.test(theme.css ?? "") ? "dark" : "light";
}

/** 生效造型语言：偏好为 theme 时跟随主题声明（未声明按 A 纸面）。 */
export function resolveShapeLang(theme: ThemeDefinition, pref: ShapePreference): ShapeLang {
  return pref === "theme" ? theme.lang ?? "a" : pref;
}

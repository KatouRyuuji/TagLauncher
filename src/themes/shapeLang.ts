// ============================================================================
// themes/shapeLang.ts — 造型语言层结构令牌（A 纸面 / B 仪表）
// ----------------------------------------------------------------------------
// 结构令牌集中在此维护，随主题的语言 × 亮暗分叉：
//   共享原语：字号阶梯 12/13/14/16/18、空间 4px 原子阶梯、时长 180/240/400、
//     字重 400/500/600/700、侧栏宽 232
//   A 纸面：圆角 6/10/14/18/22/28、缓动 cubic-bezier(0.2,0.72,0.2,1)、
//           双层软影、发丝边按亮暗分叉（亮=text 13%/24% 派生；暗=border-default
//           向 text 提亮派生，与 hairline 同色温）、
//           签名浮层影 lift = 0 2px 4px -2px + 0 12px 28px -14px、纸面顶唇、
//           输入静息纸槽影
//   B 仪表：圆角 0/2/4/4、硬影 0 1px 0 0、急停缓动 cubic-bezier(0.16,1,0.3,1)、
//           壳体双线框 --frame、正文/展示字体回 UI 无衬线（不走楷体）
// 造型语言由主题自身声明（ThemeDefinition.lang），随主题生效。
// 字体方案：UI = Noto Sans SC、阅读/展示 = LXGW WenKai（仅 A；OFL）、
//   等宽 = Cascadia Code（OFL），均为本地打包字体 + 系统字体兜底。
// ============================================================================

import type { ThemeDefinition } from "../types/theme";

export type ShapeLang = "a" | "b";
export type ShapeScheme = "light" | "dark";

// 三角色字体（UI / 阅读 / 等宽）的本地打包形态：
// @fontsource-variable 注册 "Noto Sans SC Variable"（可变字重），
// lxgw-wenkai-webfont 注册 "LXGW WenKai"，@fontsource 注册 "Cascadia Code"；其后为系统字体兜底。
const FONT_UI = "\"Noto Sans SC Variable\", \"Noto Sans SC\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"MiSans\", system-ui, -apple-system, \"Segoe UI\", sans-serif";
const FONT_READING = "\"LXGW WenKai\", \"LXGW WenKai GB\", \"Kaiti SC\", \"STKaiti\", \"KaiTi\", \"Noto Sans SC\", serif";
const FONT_MONO = "\"Cascadia Code\", \"Cascadia Mono\", \"JetBrains Mono\", \"Fira Code\", Consolas, \"Courier New\", monospace";

const EASE_A = "cubic-bezier(0.2, 0.72, 0.2, 1)"; // A 纸面平滑缓动
const EASE_B = "cubic-bezier(0.16, 1, 0.3, 1)"; // B 仪表急停缓动

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
  "sidebar-width": "232px",
  "radius-full": "999px",
};

/** 语言分叉：圆角档、缓动、正文字体（B 回 UI 无衬线） */
const LANG_TOKENS: Record<ShapeLang, Record<string, string>> = {
  a: {
    "font-family-body": FONT_READING,
    "radius-sm": "6px",
    "radius-md": "10px",
    "radius-lg": "14px",
    "radius-xl": "18px",
    "radius-2xl": "22px",
    "radius-3xl": "28px",
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
    "radius-sm": "0px",
    "radius-md": "2px",
    "radius-lg": "4px",
    "radius-xl": "4px",
    "radius-2xl": "4px",
    "radius-3xl": "4px",
    "shadow-well": "none",
    "shadow-focus": "none",
    "transition-fast": `180ms ${EASE_B}`,
    "transition-normal": `240ms ${EASE_B}`,
    "transition-slow": `400ms ${EASE_B}`,
  },
};

/**
 * 发丝边按亮暗分叉（A 专有）：
 * 亮色沿用 text 透明度派生（深字压出的中性灰线）；
 * 暗色改从 border-default 向 text 提亮派生——与 hairline/border-default 同家族
 * 色温，避免「染色实色线」与「白调亮度线」同屏打架（第三轮评审：深色边框线不和谐）。
 */
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

/**
 * 阴影配方（A：sm 静息 / lift 签名浮层影；卡/面板 = lift + 顶唇，
 * 顶唇随亮暗换档并入 shadow-card/shadow-dropdown，消费侧无需再叠唇；
 * B：硬影体系，卡/浮层 = --frame 双线内框 + 硬影，frame 定义在 index.css
 * 的 data-shape="b" 块，此处经 var() 引用在运行时解析）。
 */
const SHADOW_TOKENS: Record<ShapeLang, Record<ShapeScheme, Record<string, string>>> = {
  a: {
    light: {
      "shadow-sm": "0 1px 2px rgb(26 31 36 / 0.04), 0 4px 12px -4px rgb(26 31 36 / 0.05)",
      "shadow-md": "0 2px 4px rgb(26 31 36 / 0.07), 0 12px 32px rgb(26 31 36 / 0.08)",
      "shadow-lg": "0 2px 6px rgb(26 31 36 / 0.08), 0 16px 40px rgb(26 31 36 / 0.1)",
      "shadow-lift":
        "0 2px 4px -2px color-mix(in srgb, var(--text-primary) 10%, transparent), 0 12px 28px -14px color-mix(in srgb, var(--text-primary) 16%, transparent)",
      "shadow-overlay":
        "0 2px 4px -2px color-mix(in srgb, var(--text-primary) 10%, transparent), 0 12px 28px -14px color-mix(in srgb, var(--text-primary) 16%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.86)",
      "shadow-dropdown":
        "0 2px 6px rgb(26 31 36 / 0.08), 0 16px 40px rgb(26 31 36 / 0.1), inset 0 1px 0 rgb(255 255 255 / 0.86)",
      "shadow-card":
        "0 2px 4px -2px color-mix(in srgb, var(--text-primary) 10%, transparent), 0 12px 28px -14px color-mix(in srgb, var(--text-primary) 16%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.86)",
      "shadow-glow": "none",
    },
    dark: {
      "shadow-sm": "0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.24)",
      "shadow-md": "0 2px 4px rgb(0 0 0 / 0.34), 0 12px 32px rgb(0 0 0 / 0.28)",
      "shadow-lg": "0 2px 6px rgb(0 0 0 / 0.38), 0 16px 40px rgb(0 0 0 / 0.32)",
      "shadow-lift": "0 2px 4px -2px rgb(0 0 0 / 0.25), 0 12px 28px -14px rgb(0 0 0 / 0.35)",
      // 暗色顶唇降到 4%：与描边合并读作一层受光边，不再是描边+顶唇+投影三层亮线
      "shadow-overlay":
        "0 2px 4px -2px rgb(0 0 0 / 0.25), 0 12px 28px -14px rgb(0 0 0 / 0.35), inset 0 1px 0 rgb(255 255 255 / 0.04)",
      "shadow-dropdown":
        "0 2px 6px rgb(0 0 0 / 0.38), 0 16px 40px rgb(0 0 0 / 0.32), inset 0 1px 0 rgb(255 255 255 / 0.04)",
      "shadow-card":
        "0 2px 4px -2px rgb(0 0 0 / 0.25), 0 12px 28px -14px rgb(0 0 0 / 0.35), inset 0 1px 0 rgb(255 255 255 / 0.04)",
      "shadow-glow": "none",
    },
  },
  b: {
    light: {
      "shadow-sm": "0 1px 0 0 rgb(18 32 40 / 0.06)",
      "shadow-md": "0 1px 0 0 rgb(18 32 40 / 0.06), 0 2px 4px -2px rgb(18 32 40 / 0.08)",
      "shadow-lg": "0 2px 6px -2px rgb(18 32 40 / 0.1)",
      "shadow-lift": "0 1px 0 0 rgb(18 32 40 / 0.06), 0 2px 4px -2px rgb(18 32 40 / 0.08)",
      "shadow-overlay": "var(--frame), 0 2px 6px -2px rgb(18 32 40 / 0.1)",
      "shadow-dropdown": "var(--frame), 0 1px 0 0 rgb(18 32 40 / 0.06), 0 2px 4px -2px rgb(18 32 40 / 0.08)",
      "shadow-card": "var(--frame), 0 1px 0 0 rgb(18 32 40 / 0.06)",
      "shadow-glow": "none",
    },
    dark: {
      "shadow-sm": "0 1px 0 0 rgb(0 0 0 / 0.3)",
      "shadow-md": "0 1px 0 0 rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.35)",
      "shadow-lg": "0 2px 6px -2px rgb(0 0 0 / 0.4)",
      "shadow-lift": "0 1px 0 0 rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.35)",
      "shadow-overlay": "var(--frame), 0 2px 6px -2px rgb(0 0 0 / 0.4)",
      "shadow-dropdown": "var(--frame), 0 1px 0 0 rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.35)",
      "shadow-card": "var(--frame), 0 1px 0 0 rgb(0 0 0 / 0.3)",
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

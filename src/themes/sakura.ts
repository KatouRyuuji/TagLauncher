import type { ThemeDefinition } from "../types/theme";
import { shapeLangTokens } from "./shapeLang";
import { CHROME_TOKENS } from "./chromeTokens";

export const sakuraTheme: ThemeDefinition = {
  // 唯一标识为固定 uuid（已被用户配置持久化，不可变更）；显示名是自由文本
  id: "7f47aab2-74bb-4c77-b99b-550f0acf3c9c",
  name: "霜靛",
  author: "TagLauncher",
  version: "6.2.0",
  isPreset: true,
  lang: "a",
  variables: {
    // 结构令牌严格取自 RyuujiDesign A 纸面语言（themes/shapeLang.ts），勿在此手改
    ...shapeLangTokens("a", "light"),

    "bg-gradient": "linear-gradient(180deg, #f3f7fc 0%, #e2e3fb 100%)",
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": "linear-gradient(180deg, rgba(74, 81, 232, 0.1), transparent)",
    "media-caption-gradient": "linear-gradient(to top, color-mix(in srgb, #29313d 76%, transparent), transparent)",
    "status-warning-bg": "#fdf3e1",
    "status-success-bg": "#e2f3ee",
    "tag-preset-colors": "#4a51e8,#e3253f,#9550e0,#568213,#108289,#e7134b,#ee9708,#0e9f6e",

    "grid-col-min": "224px",

    "bg-base": "#f3f7fc",
    "bg-surface": "#ffffff",
    "bg-elevated": "#ffffff",
    "bg-overlay": "#ffffff",
    "bg-hover": "rgba(74, 81, 232, 0.07)",
    "bg-active": "rgba(74, 81, 232, 0.13)",
    "bg-card": "#ffffff",
    "bg-card-hover": "#ffffff",
    "bg-input": "#ffffff",
    "text-primary": "#29313d",
    "text-secondary": "#47536b",
    "text-tertiary": "#6b7791",
    "text-muted": "rgba(107, 119, 145, 0.85)",
    "text-faint": "rgba(107, 119, 145, 0.62)",
    "text-ghost": "#dae3ee",
    "text-placeholder": "rgba(107, 119, 145, 0.78)",
    "text-invert": "#ffffff",
    "border-subtle": "rgba(153, 163, 180, 0.32)",
    "border-default": "#dae3ee",
    "border-medium": "#99a3b4",
    "border-strong": "rgba(41, 49, 61, 0.55)",
    "accent-primary": "#4a51e8",
    "accent-primary-hover": "color-mix(in srgb, #4a51e8 85%, #000000)",
    "accent-primary-bg": "rgba(74, 81, 232, 0.13)",
    "accent-primary-bg-light": "rgba(74, 81, 232, 0.07)",
    "color-focus-ring": "#4a51e8",
    "color-danger": "#d92d5c",
    "color-danger-hover": "color-mix(in srgb, #d92d5c 85%, #000000)",
    "color-danger-bg": "#fae6eb",
    "color-warning": "#ee9708",
    "color-success": "#0e9f6e",
    "color-favorite": "#ee9708",
    "overlay-bg": "color-mix(in srgb, #29313d 34%, transparent)",
    "scrollbar-thumb": "rgba(156, 167, 183, 0.55)",
    "scrollbar-thumb-hover": "#9ca7b7",

    // 壳层共享令牌（z 层级/拖拽/标签透明度/边框/面板规格），勿在此手改
    ...CHROME_TOKENS,

    "panel-titlebar-bg": "#ffffff",
    "panel-body-bg": "#ffffff",
  },
  css: [
    "html { color-scheme: light; }",
    ".app-frame {",
    "  background: var(--bg-base);",
    "}",
    ".text-label { color: var(--text-faint); }",
  ].join("\n"),
};

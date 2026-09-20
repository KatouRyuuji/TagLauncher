import type { ThemeDefinition } from "../types/theme";
import { shapeLangTokens } from "./shapeLang";
import { CHROME_TOKENS } from "./chromeTokens";

// 霜靛·亮：与 ryuuji.ts 工厂同一套内置色板值；独立成文件仅因 uuid 已被用户配置持久化。
export const sakuraTheme: ThemeDefinition = {
  // 唯一标识为固定 uuid（已被用户配置持久化，不可变更）；显示名是自由文本
  id: "7f47aab2-74bb-4c77-b99b-550f0acf3c9c",
  name: "霜靛",
  author: "TagLauncher",
  version: "7.0.0",
  isPreset: true,
  lang: "a",
  variables: {
    // 结构令牌统一走 themes/shapeLang.ts（A 纸面语言），勿在此手改
    ...shapeLangTokens("a", "light"),

    "bg-gradient": "linear-gradient(180deg, #eef2fc 0%, #e6ebfa 100%)",
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": "linear-gradient(180deg, rgba(80, 100, 216, 0.1), transparent)",
    "media-caption-gradient": "linear-gradient(to top, color-mix(in srgb, #29313d 76%, transparent), transparent)",
    "status-warning-bg": "#fdf3e1",
    "status-success-bg": "#e2f3ee",
    "color-success-ink": "#0b7854",
    "color-warning-ink": "#945e05",
    "color-info-ink": "#07738b",
    // 8 色位与工厂 TAGS 表同语义序（主色/跨族A/跨族B/中性/琥珀/绿/橙/蓝），
    // 保证霜靛亮↔暗、亮↔其他家族切换时标签色相稳定、只随亮暗换明度
    "tag-preset-colors": "#5064d8,#8f5fc5,#d63865,#242424,#e89e06,#1faa62,#ea580c,#1f8ad8",

    "grid-col-min": "256px",

    "bg-base": "#eef2fc",
    "bg-surface": "#ffffff",
    "bg-elevated": "#ffffff",
    "bg-overlay": "#ffffff",
    "bg-hover": "color-mix(in srgb, #ffffff 72%, #eef2fc)",
    "bg-active": "rgba(80, 100, 216, 0.13)",
    "bg-card": "#ffffff",
    "bg-card-hover": "#ffffff",
    "bg-input": "color-mix(in srgb, #ffffff 62%, #eef2fc)",
    "bg-input-hover": "color-mix(in srgb, #ffffff 72%, #eef2fc)",
    "text-primary": "#29313d",
    "text-secondary": "#47536b",
    "text-tertiary": "#5f6a81",
    "text-muted": "#5f6a81",
    "text-faint": "#5f6a81",
    "text-ghost": "#dae3ee",
    "text-placeholder": "#5f6a81",
    "text-invert": "#ffffff",
    "border-default": "#dae3ee",
    "border-strong": "rgba(41, 49, 61, 0.55)",
    "accent-primary": "#5064d8",
    "accent-primary-hover": "color-mix(in srgb, #5064d8 96%, #000000)",
    "accent-primary-bg": "rgba(80, 100, 216, 0.09)",
    "accent-primary-bg-light": "rgba(80, 100, 216, 0.07)",
    "accent-primary-ink": "#404f97",
    "accent-primary-shallow": "#8c99e5",
    "accent-signal": "#5064d8",
    "row-selected-bg": "#5064d8",
    "row-selected-fg": "#ffffff",
    "row-selected-sub-fg": "color-mix(in srgb, #ffffff 90%, transparent)",
    "row-selected-shadow": "inset 0 1px 0 rgb(255 255 255 / 0.22)",
    "row-selected-weight": "500",
    "color-focus-ring": "#5064d8",
    "color-danger": "#d92d5c",
    "color-on-danger": "#ffffff",
    "color-danger-hover": "color-mix(in srgb, #d92d5c 85%, #000000)",
    "color-danger-bg": "#fae6eb",
    "color-danger-ink": "#c82551",
    "color-warning": "#ee9708",
    "color-success": "#0e9f6e",
    "color-favorite": "#ee9708",
    "overlay-bg": "color-mix(in srgb, #29313d 42%, transparent)",
    "scrollbar-thumb": "#9ca7b7",
    "scrollbar-thumb-hover": "#47536b",

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

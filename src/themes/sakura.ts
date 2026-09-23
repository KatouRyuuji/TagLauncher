import type { ThemeDefinition } from "../types/theme";
import { shapeLangTokens } from "./shapeLang";
import { CHROME_TOKENS } from "./chromeTokens";

// 霜靛·亮：独立保存已持久化的主题 uuid；采用清冷纸面，并共享工作台结构。
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

    "bg-gradient": "#f5f7fa",
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": "linear-gradient(180deg, rgba(80, 100, 216, 0.1), transparent)",
    "media-caption-gradient": "linear-gradient(to top, color-mix(in srgb, #29313d 76%, transparent), transparent)",
    "status-warning-bg": "#fdf3e1",
    "status-success-bg": "#e2f3ee",
    "color-success-ink": "#0b7854",
    "color-warning-ink": "#945e05",
    "color-info-ink": "#07738b",
    // 与霜靛暗同槽同色相，颜色承担分类识别，界面只展示柔和色纸。
    "tag-preset-colors": "#365e9d,#7050a0,#a34469,#59616b,#826a23,#3e754f,#a05e31,#247b71,#a14e48,#755940",

    "grid-col-min": "256px",

    "bg-base": "#f5f7fa",
    "bg-surface": "#fcfdfe",
    "bg-elevated": "#fcfdfe",
    "bg-overlay": "#fcfdfe",
    "bg-hover": "#edf1f5",
    "bg-active": "rgba(79, 97, 140, 0.08)",
    "bg-card": "#fcfdfe",
    "bg-card-hover": "#fcfdfe",
    "bg-input": "#fcfdfe",
    "bg-input-hover": "#fcfdfe",
    "text-primary": "#273140",
    "text-secondary": "#515e6c",
    "text-tertiary": "#626e7c",
    "text-muted": "#626e7c",
    "text-faint": "#626e7c",
    "text-ghost": "#c3c9c0",
    "text-placeholder": "#626e7c",
    "text-invert": "#ffffff",
    "border-default": "#e1e6ed",
    "border-strong": "#c5ced9",
    "accent-primary": "#4f618c",
    "accent-primary-hover": "color-mix(in srgb, #4f618c 94%, #000000)",
    "accent-primary-bg": "rgba(79, 97, 140, 0.1)",
    "accent-primary-bg-light": "rgba(79, 97, 140, 0.06)",
    "accent-primary-ink": "#3b4c70",
    "accent-primary-shallow": "#8e9bb9",
    "accent-signal": "#4f618c",
    "row-selected-bg": "rgba(79, 97, 140, 0.12)",
    "row-selected-fg": "#273140",
    "row-selected-sub-fg": "#515e6c",
    "row-selected-shadow": "none",
    "row-selected-weight": "600",
    "color-focus-ring": "#4f618c",
    "color-danger": "#d92d5c",
    "color-on-danger": "#ffffff",
    "color-danger-hover": "color-mix(in srgb, #d92d5c 85%, #000000)",
    "color-danger-bg": "#fae6eb",
    "color-danger-ink": "#c82551",
    "color-warning": "#ee9708",
    "color-success": "#0e9f6e",
    "color-favorite": "#4f618c",
    "overlay-bg": "rgba(24, 28, 34, 0.42)",
    "scrollbar-thumb": "#c5ced9",
    "scrollbar-thumb-hover": "#626e7c",

    // 壳层共享令牌（z 层级/拖拽/标签透明度/边框/面板规格），勿在此手改
    ...CHROME_TOKENS,

    "panel-titlebar-bg": "#fcfdfe",
    "panel-body-bg": "#fcfdfe",
  },
  css: [
    "html { color-scheme: light; }",
    ".app-frame {",
    "  background: var(--bg-base);",
    "}",
    ".text-label { color: var(--text-faint); }",
  ].join("\n"),
};

/**
 * 深色主题 — Catppuccin Mocha
 * 灵感来源: https://catppuccin.com/palette/
 * 特色: 暖紫灰底色（#1e1e2e），告别冷灰/纯黑；
 *       月光蓝强调色（#89b4fa）；紧凑圆角；无装饰效果。
 */
import type { ThemeDefinition } from "../types/theme";

export const darkTheme: ThemeDefinition = {
  id: "dark",
  name: "深色",
  author: "Catppuccin",
  version: "3.0.0",
  isPreset: true,
  variables: {
    // ── Typography ──────────────────────────────────────────
    "font-family": "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    "font-family-mono": "'JetBrains Mono', 'Cascadia Code', monospace",
    "font-size-xs": "11px",
    "font-size-sm": "13px",
    "font-size-base": "14px",
    "font-size-lg": "16px",
    "font-size-xl": "18px",
    "font-weight-normal": "400",
    "font-weight-medium": "500",
    "font-weight-bold": "600",
    "line-height-tight": "1.25",
    "line-height-normal": "1.5",
    "letter-spacing": "0em",

    // ── Radius — 中等，现代精准 ─────────────────────────────
    "radius-sm": "4px",
    "radius-md": "8px",
    "radius-lg": "12px",
    "radius-xl": "16px",
    "radius-full": "9999px",

    // ── Shadows — 深紫色调，强调层次感 ─────────────────────
    "shadow-sm": "0 1px 2px rgba(0,0,0,0.45)",
    "shadow-md": "0 4px 12px rgba(0,0,0,0.55)",
    "shadow-lg": "0 12px 40px rgba(0,0,0,0.65)",
    "shadow-overlay": "0 24px 64px rgba(0,0,0,0.78), 0 4px 16px rgba(0,0,0,0.4)",
    "shadow-dropdown": "0 8px 24px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.3)",
    "shadow-card": "none",
    "shadow-glow": "none",

    // ── Spacing ─────────────────────────────────────────────
    "spacing-unit": "4px",
    "spacing-xs": "4px",
    "spacing-sm": "8px",
    "spacing-md": "12px",
    "spacing-lg": "16px",
    "spacing-xl": "24px",

    // ── Motion — 快速响应 ────────────────────────────────────
    "transition-fast": "120ms ease",
    "transition-normal": "200ms ease",
    "transition-slow": "350ms ease",

    // ── Decorative — 极subtle蓝色光晕提升质感 ─────────────
    // 右上角极淡月光蓝，不影响深色整体感但增加层次
    "bg-gradient": "radial-gradient(ellipse 65% 45% at 100% 0%, rgba(137,180,250,0.05) 0%, transparent 55%)",
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": "radial-gradient(circle at 85% 12%, rgba(137,180,250,0.18), transparent 38%)",
    "media-caption-gradient": "linear-gradient(to top, rgba(0,0,0,0.68), transparent)",
    "status-warning-bg": "rgba(249,226,175,0.1)",
    "status-success-bg": "rgba(166,227,161,0.1)",
    "tag-preset-colors": "#f38ba8,#fab387,#f9e2af,#a6e3a1,#94e2d5,#89b4fa,#cba6f7,#f5c2e7",

    // ── Layout ──────────────────────────────────────────────
    "sidebar-width": "208px",
    "grid-col-min": "170px",
    "header-height": "56px",

    // ── Colors — Catppuccin Mocha ────────────────────────────
    // 背景层次（从深到浅）
    "bg-base":     "#1e1e2e",  // Mocha Base — 主背景，暖紫灰
    "bg-surface":  "#181825",  // Mocha Mantle — 侧边栏/顶栏，更深
    "bg-card":     "#252535",  // 卡片，略高于 Base
    "bg-hover":    "#313244",  // Mocha Surface0 — 悬停高亮
    "bg-active":   "#45475a",  // Mocha Surface1 — 激活/选中
    "bg-overlay":  "#313244",  // 下拉菜单背景
    "bg-elevated": "#2a2a40",  // 对话框/设置面板
    "bg-card-hover": "#313244",
    "bg-input":    "#181825",

    // 文本层次
    "text-primary":     "#cdd6f4",  // Mocha Text
    "text-secondary":   "#bac2de",  // Mocha Subtext1
    "text-tertiary":    "#a6adc8",  // Mocha Subtext0
    "text-muted":       "#7f849c",  // Mocha Overlay1
    "text-faint":       "#6c7086",  // Mocha Overlay0
    "text-ghost":       "#585b70",  // Mocha Surface2
    "text-placeholder": "#6c7086",
    "text-invert":      "#1e1e2e",

    // 边框
    "border-subtle":  "#313244",  // Mocha Surface0
    "border-default": "#45475a",  // Mocha Surface1
    "border-medium":  "#585b70",  // Mocha Surface2
    "border-strong":  "#7f849c",  // Mocha Overlay1

    // 强调色 — Mocha Blue（月光蓝，柔和不刺眼）
    "accent-primary":          "#89b4fa",
    "accent-primary-hover":    "#74c7ec",
    "accent-primary-bg":       "rgba(137,180,250,0.15)",
    "accent-primary-bg-light": "rgba(137,180,250,0.08)",

    // 状态色
    "color-danger":      "#f38ba8",                   // Mocha Red
    "color-danger-hover": "#eba0ac",                  // Mocha Maroon
    "color-danger-bg":   "rgba(243,139,168,0.12)",
    "color-warning":     "#f9e2af",                   // Mocha Yellow
    "color-success":     "#a6e3a1",                   // Mocha Green
    "color-favorite":    "#f9e2af",

    // 遮罩
    "overlay-bg":            "rgba(0, 0, 0, 0.55)",

    // 滚动条
    "scrollbar-thumb":       "#45475a",
    "scrollbar-thumb-hover": "#585b70",

    // ── Z-Index Layers ──────────────────────────────────────────
    "z-bg-decoration":       "0",
    "z-context-overlay":     "99",
    "z-context-menu":        "100",
    "z-context-submenu":     "110",
    "z-drag-ghost":          "120",
    "z-welcome-modal":       "120",
    "z-floating-panel":      "150",
    "z-settings-overlay":    "200",
    "z-settings-panel":      "201",
    "z-mod-confirm-overlay": "250",
    "z-mod-confirm-panel":   "251",
    "z-migration-overlay":   "300",
    "z-migration-panel":     "301",
    "z-toast":               "500",

    // ── Interaction Details ──────────────────────────────────────
    "drag-ghost-offset-x": "14px",
    "drag-ghost-offset-y": "14px",
    "tag-color-alpha":     "20%",
    "tag-selected-alpha":  "28%",
    "tag-muted-alpha":     "12%",
    "tag-selected-border-alpha": "66%",
    "border-width":        "1px",
    "border-style":        "solid",

    // ── Panel UI ────────────────────────────────────────────────
    "panel-floating-min-width":    "280px",
    "panel-floating-min-height":   "200px",
    "panel-floating-border-radius":"var(--radius-lg)",
    "panel-titlebar-height":       "36px",
    "panel-titlebar-bg":           "var(--bg-surface)",
    "panel-body-bg":               "var(--bg-elevated)",
    "panel-border-color":          "var(--border-default)",
  },
};

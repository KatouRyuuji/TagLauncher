/**
 * 亮色主题 — Catppuccin Latte
 * 灵感来源: https://catppuccin.com/palette/
 * 特色: 奶油暖白底色（#eff1f5），告别冷灰白；
 *       深蓝强调色（#1e66f5）饱和而不刺眼；
 *       暖灰阴影模拟纸张叠加质感；圆角略大更柔和。
 */
import type { ThemeDefinition } from "../types/theme";

export const lightTheme: ThemeDefinition = {
  id: "light",
  name: "亮色",
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
    "line-height-tight": "1.3",
    "line-height-normal": "1.55",
    "letter-spacing": "0.01em",  // 稍宽，提升中文可读性

    // ── Radius — 略大，柔和包裹感 ──────────────────────────
    "radius-sm": "5px",
    "radius-md": "10px",
    "radius-lg": "14px",
    "radius-xl": "18px",
    "radius-full": "9999px",

    // ── Shadows — 暖灰色，模拟纸张叠加 ────────────────────
    "shadow-sm":      "0 1px 3px rgba(76,79,105,0.08), 0 1px 2px rgba(76,79,105,0.05)",
    "shadow-md":      "0 4px 12px rgba(76,79,105,0.12), 0 2px 4px rgba(76,79,105,0.06)",
    "shadow-lg":      "0 12px 32px rgba(76,79,105,0.15), 0 4px 8px rgba(76,79,105,0.08)",
    "shadow-overlay": "0 24px 64px rgba(76,79,105,0.22), 0 4px 16px rgba(76,79,105,0.1)",
    "shadow-dropdown":"0 8px 24px rgba(76,79,105,0.13), 0 2px 6px rgba(76,79,105,0.08)",
    "shadow-card":    "0 1px 4px rgba(76,79,105,0.08), 0 0 0 1px rgba(76,79,105,0.05)",
    "shadow-glow":    "none",

    // ── Spacing ─────────────────────────────────────────────
    "spacing-unit": "4px",
    "spacing-xs": "4px",
    "spacing-sm": "8px",
    "spacing-md": "12px",
    "spacing-lg": "16px",
    "spacing-xl": "24px",

    // ── Motion — 略慢，更优雅从容 ───────────────────────────
    "transition-fast": "140ms ease",
    "transition-normal": "220ms ease",
    "transition-slow": "380ms ease",

    // ── Decorative — 极subtle蓝色角落光晕 ─────────────────
    // 左上角极淡蓝紫，不影响亮色整体感但增加现代感
    "bg-gradient": "radial-gradient(ellipse 55% 40% at 0% 0%, rgba(30,102,245,0.04) 0%, transparent 50%)",
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",

    // ── Layout ──────────────────────────────────────────────
    "sidebar-width": "208px",
    "grid-col-min": "170px",
    "header-height": "56px",

    // ── Colors — Catppuccin Latte ────────────────────────────
    // 背景层次（从浅到深）
    "bg-base":     "#eff1f5",  // Latte Base — 奶油暖白，不刺眼
    "bg-surface":  "#e6e9ef",  // Latte Mantle — 侧边栏/顶栏略深
    "bg-card":     "#ffffff",  // 纯白卡片，与背景有对比
    "bg-hover":    "#e6e9ef",  // Latte Mantle
    "bg-active":   "#dce0e8",  // Latte Crust
    "bg-overlay":  "#ffffff",  // 下拉菜单
    "bg-elevated": "#ffffff",  // 对话框
    "bg-card-hover": "#f0f2f7",
    "bg-input":    "#ffffff",

    // 文本层次（暖灰色调）
    "text-primary":     "#4c4f69",  // Latte Text — 深暖灰，舒适易读
    "text-secondary":   "#5c5f77",  // Latte Subtext1
    "text-tertiary":    "#6c6f85",  // Latte Subtext0
    "text-muted":       "#8c8fa1",  // Latte Overlay1
    "text-faint":       "#9ca0b0",  // Latte Overlay0
    "text-ghost":       "#acb0be",  // Latte Surface2
    "text-placeholder": "#9ca0b0",
    "text-invert":      "#eff1f5",

    // 边框（暖色调，不冷）
    "border-subtle":  "#e0e3eb",  // 比 Surface0 稍浅
    "border-default": "#ccd0da",  // Latte Surface0
    "border-medium":  "#bcc0cc",  // Latte Surface1
    "border-strong":  "#8c8fa1",  // Latte Overlay1

    // 强调色 — Latte Blue（饱和深蓝，清晰有力）
    "accent-primary":          "#1e66f5",
    "accent-primary-hover":    "#1a56db",
    "accent-primary-bg":       "rgba(30,102,245,0.1)",
    "accent-primary-bg-light": "rgba(30,102,245,0.06)",

    // 状态色
    "color-danger":       "#d20f39",                 // Latte Red
    "color-danger-hover": "#e64553",                 // Latte Maroon
    "color-danger-bg":    "rgba(210,15,57,0.08)",
    "color-warning":      "#df8e1d",                 // Latte Yellow
    "color-success":      "#40a02b",                 // Latte Green
    "color-favorite":     "#df8e1d",

    // 遮罩
    "overlay-bg":            "rgba(76, 79, 105, 0.38)",

    // 滚动条
    "scrollbar-thumb":       "#bcc0cc",
    "scrollbar-thumb-hover": "#acb0be",
  },
};

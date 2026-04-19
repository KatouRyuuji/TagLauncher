/**
 * 樱花主题 — 花（Hana）白粉色浅色系
 *
 * 设计参考：
 *   - 樱花经典粉 #FFB7C5  https://www.color-hex.com/color-palette/18061
 *   - Rosé Pine Dawn 底色 #faf4ed  https://rosepinetheme.com/palette/
 *   - 日系 App UI 2024 趋势：白色/浅粉底色 + 圆形字体 + 粉色调
 *   - Glassmorphism 现代设计趋势
 *
 * 特色：
 *   近白粉底色（#fdf4f7），如春日晴空下的樱花林；
 *   深樱桃粉强调色（#c2416f）对比度充足；
 *   暖粉色调阴影替代冷灰色；
 *   超大圆角 + 日系圆润字体；
 *   淡粉色角落光晕营造春日氛围。
 */
import type { ThemeDefinition } from "../types/theme";

export const sakuraTheme: ThemeDefinition = {
  id: "sakura",
  name: "樱花",
  author: "Hana",
  version: "3.0.0",
  isPreset: true,
  variables: {
    // ── Typography — 日系圆润字体 ──────────────────────────
    "font-family": "'Zen Maru Gothic', 'LXGW WenKai', 'Hiragino Maru Gothic ProN', 'PingFang SC', system-ui, sans-serif",
    "font-family-mono": "'JetBrains Mono', 'Cascadia Code', monospace",
    "font-size-xs": "11px",
    "font-size-sm": "13px",
    "font-size-base": "14px",
    "font-size-lg": "16px",
    "font-size-xl": "18px",
    "font-weight-normal": "400",
    "font-weight-medium": "500",
    "font-weight-bold": "700",
    "line-height-tight": "1.4",
    "line-height-normal": "1.65",
    "letter-spacing": "0.02em",

    // ── Radius — 超大圆角，花瓣般柔软 ─────────────────────
    "radius-sm": "6px",
    "radius-md": "12px",
    "radius-lg": "18px",
    "radius-xl": "24px",
    "radius-full": "9999px",

    // ── Shadows — 粉暖色调阴影，替代冷灰 ──────────────────
    "shadow-sm":      "0 1px 3px rgba(180,80,120,0.08), 0 1px 2px rgba(180,80,120,0.05)",
    "shadow-md":      "0 4px 12px rgba(180,80,120,0.12), 0 2px 4px rgba(180,80,120,0.06)",
    "shadow-lg":      "0 12px 32px rgba(180,80,120,0.15), 0 4px 8px rgba(180,80,120,0.08)",
    "shadow-overlay": "0 24px 64px rgba(180,80,120,0.18), 0 4px 16px rgba(100,20,50,0.08)",
    "shadow-dropdown":"0 8px 24px rgba(180,80,120,0.12), 0 2px 6px rgba(180,80,120,0.07)",
    "shadow-card":    "0 1px 4px rgba(180,80,120,0.1), 0 0 0 1px rgba(180,80,120,0.07)",
    "shadow-glow":    "0 0 20px rgba(194,65,111,0.2), 0 0 40px rgba(194,65,111,0.08)",

    // ── Spacing ─────────────────────────────────────────────
    "spacing-unit": "4px",
    "spacing-xs": "4px",
    "spacing-sm": "8px",
    "spacing-md": "12px",
    "spacing-lg": "16px",
    "spacing-xl": "24px",

    // ── Motion — 轻盈自然，如花瓣落下 ──────────────────────
    "transition-fast":   "160ms cubic-bezier(0.34, 1.56, 0.64, 1)",  // 带轻微弹性
    "transition-normal": "280ms cubic-bezier(0.4, 0, 0.2, 1)",
    "transition-slow":   "450ms cubic-bezier(0.4, 0, 0.2, 1)",

    // ── Decorative — 春日角落光晕 ───────────────────────────
    // 左上角樱花粉光源（如阳光透过花枝），右下角淡玫瑰光晕
    "bg-gradient": [
      "radial-gradient(ellipse 70% 50% at 2% 5%, rgba(255,182,200,0.35) 0%, transparent 55%)",
      "radial-gradient(ellipse 55% 40% at 98% 96%, rgba(255,160,185,0.28) 0%, transparent 50%)",
      "radial-gradient(ellipse 35% 28% at 50% 100%, rgba(255,200,215,0.15) 0%, transparent 55%)",
    ].join(", "),
    "card-backdrop-filter": "none",      // 浅色主题不需要毛玻璃（避免奇怪效果）
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": "radial-gradient(circle at 85% 12%, rgba(194,65,111,0.16), transparent 38%)",
    "media-caption-gradient": "linear-gradient(to top, rgba(61,30,53,0.54), transparent)",
    "status-warning-bg": "rgba(184,121,40,0.1)",
    "status-success-bg": "rgba(46,125,82,0.1)",
    "tag-preset-colors": "#c4334c,#d96a4d,#b87928,#2e7d52,#2a9d8f,#4f7cff,#a05bc1,#c2416f",

    // ── Layout ──────────────────────────────────────────────
    "sidebar-width": "208px",
    "grid-col-min": "170px",
    "header-height": "56px",

    // ── Colors — 白粉色浅色系 ────────────────────────────────
    // 背景（从近白到淡粉，层次感）
    "bg-base":     "#fdf4f7",  // 近白，带极淡粉色，主背景
    "bg-surface":  "#f7e8f0",  // 淡粉，侧边栏/顶栏
    "bg-card":     "#ffffff",  // 纯白卡片，与背景形成对比
    "bg-hover":    "#fce4ee",  // 悬停：浅樱花粉
    "bg-active":   "#f8d0e4",  // 激活：稍深粉
    "bg-overlay":  "#ffffff",  // 下拉菜单
    "bg-elevated": "#ffffff",  // 对话框
    "bg-card-hover": "#fff5f9",
    "bg-input":    "#ffffff",

    // 文本（深暖玫瑰褐色，白底上对比度充足）
    "text-primary":     "#3d1e35",  // 深暖玫瑰褐，主文字
    "text-secondary":   "#6b3d5c",  // 中等玫瑰
    "text-tertiary":    "#8d5f78",  // 浅玫瑰灰
    "text-muted":       "#b08a9e",  // 静音色
    "text-faint":       "#c8aab8",  // 淡色
    "text-ghost":       "#e0d0d8",  // 占位符级
    "text-placeholder": "#c0a0b0",
    "text-invert":      "#fdf4f7",  // 用于强调按钮上的文字

    // 边框（粉色调，而非冷灰）
    "border-subtle":  "#f0dce7",  // 几乎不可见
    "border-default": "#e8c8d8",  // 标准边框
    "border-medium":  "#d8b0c5",  // 较显著边框
    "border-strong":  "#c090a8",  // 强边框

    // 强调色 — 深樱桃粉（白底上 4.5:1 对比度，符合 WCAG AA）
    "accent-primary":          "#c2416f",
    "accent-primary-hover":    "#a83060",
    "accent-primary-bg":       "rgba(194,65,111,0.1)",
    "accent-primary-bg-light": "rgba(194,65,111,0.06)",

    // 状态色（保持温暖粉色调系统）
    "color-danger":       "#c4334c",
    "color-danger-hover": "#a82040",
    "color-danger-bg":    "rgba(196,51,76,0.09)",
    "color-warning":      "#b87928",
    "color-success":      "#2e7d52",
    "color-favorite":     "#c87840",   // 温暖琥珀色

    // 遮罩（粉色调半透明）
    "overlay-bg":            "rgba(61, 30, 53, 0.42)",

    // 滚动条（粉色调）
    "scrollbar-thumb":       "rgba(194,65,111,0.22)",
    "scrollbar-thumb-hover": "rgba(194,65,111,0.45)",

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
    "tag-color-alpha":     "18%",   // 樱花主题略浅，与粉底色搭配
    "tag-selected-alpha":  "26%",
    "tag-muted-alpha":     "10%",
    "tag-selected-border-alpha": "60%",
    "border-width":        "1px",
    "border-style":        "solid",

    // ── Panel UI（樱花主题更大圆角）────────────────────────────
    "panel-floating-min-width":    "280px",
    "panel-floating-min-height":   "200px",
    "panel-floating-border-radius":"var(--radius-xl)",
    "panel-titlebar-height":       "38px",
    "panel-titlebar-bg":           "var(--bg-surface)",
    "panel-body-bg":               "var(--bg-elevated)",
    "panel-border-color":          "var(--border-default)",
  },
};

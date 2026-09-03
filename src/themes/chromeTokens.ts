// ============================================================================
// themes/chromeTokens.ts — 应用壳层共享令牌（与配色无关，各主题一致）
// ----------------------------------------------------------------------------
// z-index 层级、拖拽幻影偏移、标签透明度配方、边框规格、Mod 浮层面板规格。
// 内置主题（sakura 独立文件与 ryuuji 工厂）统一从此展开，保证全量键集一致；
// 自定义主题缺省这些键时由 DEFAULT_THEME_VARIABLES 补齐。
// ============================================================================

export const CHROME_TOKENS: Record<string, string> = {
  "z-bg-decoration": "0",
  "z-context-overlay": "99",
  "z-context-menu": "100",
  "z-context-submenu": "110",
  "z-drag-ghost": "120",
  "z-welcome-modal": "120",
  "z-floating-panel": "150",
  "z-quick-preview": "160",
  "z-settings-overlay": "200",
  "z-settings-panel": "201",
  "z-command-palette": "210",
  "z-shortcuts-help": "215",
  "z-mod-confirm-overlay": "250",
  "z-mod-confirm-panel": "251",
  "z-migration-overlay": "300",
  "z-migration-panel": "301",
  "z-toast": "500",

  "drag-ghost-offset-x": "14px",
  "drag-ghost-offset-y": "14px",
  "tag-color-alpha": "18%",
  "tag-selected-alpha": "28%",
  "tag-muted-alpha": "10%",
  "tag-selected-border-alpha": "62%",
  "border-width": "1px",
  "border-style": "solid",

  "panel-floating-min-width": "320px",
  "panel-floating-min-height": "220px",
  "panel-floating-border-radius": "var(--radius-lg)",
  "panel-titlebar-height": "40px",
  "panel-border-color": "var(--border-default)",
};

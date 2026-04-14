import type { ThemeDefinition } from "../types/theme";

const CUSTOM_CSS_ID = "__theme-css";

export function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;

  // 0. 记录当前主题 ID（供 modApi.getThemeId() 读取）
  root.setAttribute("data-theme-id", theme.id);

  // 1. 写入所有 CSS 变量
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
  }

  // 2. 注入主题自定义 CSS（用于变量无法覆盖的深度定制：布局、图标、选择器级样式）
  let styleEl = document.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;
  if (theme.css?.trim()) {
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = CUSTOM_CSS_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = theme.css;
  } else if (styleEl) {
    styleEl.textContent = "";
  }
}

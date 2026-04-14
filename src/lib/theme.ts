import type { ThemeDefinition } from "../types/theme";

const CUSTOM_CSS_ID = "__theme-css";

export function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;

  // 0. 记录当前主题 ID（供 modApi.getThemeId() 读取）
  root.setAttribute("data-theme-id", theme.id);

  // 1. 触发切换过渡动画：加 class → 变量变化时 CSS 自动过渡 → rAF 后移除 class
  root.classList.add("theme-switching");

  // 2. 写入所有 CSS 变量
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
  }

  // 3. 移除过渡 class（需等本帧绘制完成后再移除，否则过渡不触发）
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });

  // 4. 注入主题自定义 CSS（用于变量无法覆盖的深度定制：布局、图标、选择器级样式）
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

import type { ThemeDefinition } from "../types/theme";
import { DEFAULT_THEME_VARIABLES, THEME_VARIABLE_KEYS } from "../themes";

const CUSTOM_CSS_ID = "__theme-css";

/**
 * 检查 CSS 字符串中大括号是否平衡（跳过字符串字面量内容）。
 * 返回错误描述字符串，或 null（无问题）。
 */
function detectCssBraceError(css: string): string | null {
  let depth = 0;
  let inStr = false;
  let strChar = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inStr) {
      if (ch === strChar && css[i - 1] !== "\\") inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) return '包含多余的 "}"';
    }
  }
  if (depth > 0) return `${depth} 个未闭合的 "{"`;
  return null;
}

export function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  const variables = {
    ...DEFAULT_THEME_VARIABLES,
    ...theme.variables,
  };

  // 0. 记录当前主题 ID（供 modApi.getThemeId() 读取）
  root.setAttribute("data-theme-id", theme.id);

  // 1. 触发切换过渡动画：加 class → 变量变化时 CSS 自动过渡 → rAF 后移除 class
  root.classList.add("theme-switching");

  // 2. 清理契约内变量并写入默认值 + 当前主题值，避免切换不完整主题时继承上一个主题的残留值。
  for (const key of THEME_VARIABLE_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
  for (const [key, value] of Object.entries(variables)) {
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
    // 注入前检查括号平衡，不平衡时警告（仍继续注入，浏览器会尽力解析有效部分）
    const cssError = detectCssBraceError(theme.css);
    if (cssError) {
      window.dispatchEvent(
        new CustomEvent("taglauncher-toast", {
          detail: {
            message: `主题 "${theme.id}" 的 CSS 存在语法问题（${cssError}），部分样式可能无效`,
            type: "warning",
          },
        }),
      );
    }
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

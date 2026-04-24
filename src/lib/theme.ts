import type { ThemeDefinition } from "../types/theme";
import { DEFAULT_THEME_VARIABLES, THEME_VARIABLE_KEYS } from "../themes";

const CUSTOM_CSS_ID = "__theme-css";
const THEME_FONT_CSS_ID = "__theme-font-css";
const dynamicThemeVariableKeys = new Set<string>();

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
    ...theme.tokens?.primitive,
    ...theme.tokens?.semantic,
    ...flattenComponentTokens(theme.tokens?.component),
    ...theme.tokens?.motion,
    ...theme.tokens?.layout,
    ...flattenComponentTokens(theme.components),
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
  for (const key of dynamicThemeVariableKeys) {
    root.style.removeProperty(`--${key}`);
  }
  dynamicThemeVariableKeys.clear();
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(`--${key}`, value);
    if (!THEME_VARIABLE_KEYS.includes(key)) {
      dynamicThemeVariableKeys.add(key);
    }
  }
  for (const [key, value] of Object.entries(theme.assets ?? {})) {
    const variableKey = `asset-${key}`;
    root.style.setProperty(`--${variableKey}`, cssUrl(value));
    dynamicThemeVariableKeys.add(variableKey);
  }

  applyThemeFonts(theme);

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

function flattenComponentTokens(
  components?: Record<string, Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [component, tokens] of Object.entries(components ?? {})) {
    const componentKey = toKebabCase(component);
    for (const [slot, value] of Object.entries(tokens)) {
      result[`component-${componentKey}-${toKebabCase(slot)}`] = value;
    }
  }
  return result;
}

function toKebabCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function cssUrl(value: string) {
  if (/^(url\(|data:|https?:|asset:|file:)/i.test(value)) return value;
  return `url(${JSON.stringify(value)})`;
}

function applyThemeFonts(theme: ThemeDefinition) {
  let styleEl = document.getElementById(THEME_FONT_CSS_ID) as HTMLStyleElement | null;
  const fonts = theme.fonts ?? {};
  if (Object.keys(fonts).length === 0) {
    if (styleEl) styleEl.textContent = "";
    return;
  }
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = THEME_FONT_CSS_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = Object.entries(fonts)
    .map(([family, source]) => `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(source)});font-display:swap;}`)
    .join("\n");
}

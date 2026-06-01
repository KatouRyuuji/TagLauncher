import type { ThemeDefinition, ThemeTokenLayers } from "../types/theme";
import { DEFAULT_THEME_VARIABLES, THEME_VARIABLE_KEYS } from "../themes";
import { convertFileSrc } from "@tauri-apps/api/core";

const CUSTOM_CSS_ID = "__theme-css";
const THEME_FONT_CSS_ID = "__theme-font-css";
const dynamicThemeVariableKeys = new Set<string>();

/** applyTheme 可选项：主题包根目录（用于解析相对资源）与当前变体名 */
export interface ApplyThemeOptions {
  /** 主题包绝对根目录；custom/mod 来源时用于把相对路径资源转换为可访问 URL */
  themeRoot?: string;
  /** 当前激活的变体名；为空表示不叠加任何变体 */
  activeVariant?: string;
}

/**
 * 解析主题资源/字体的路径：
 * - 内置/绝对路径（data:/http(s):/url(/asset:/file: 等）保持原样
 * - 相对路径在有 themeRoot 时拼接根目录并用 convertFileSrc 转为 WebView 可访问 URL
 *   （避免 WebView 用打包根 baseURI 解析相对路径导致 404）
 */
function resolveThemeAssetSrc(value: string, themeRoot?: string): string {
  const trimmed = value.trim();
  // 已是 url()/data:/绝对 URL/协议路径，直接返回（内置主题走这里）
  if (/^(url\(|data:|https?:|asset:|file:|blob:|\/)/i.test(trimmed)) {
    return trimmed;
  }
  // Windows 盘符绝对路径（如 C:\ 或 C:/）
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return convertFileSrc(trimmed.replace(/\\/g, "/"));
  }
  // 相对路径：需要主题包根目录才能正确解析
  if (themeRoot) {
    const root = themeRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const rel = trimmed.replace(/\\/g, "/").replace(/^\.?\//, "");
    return convertFileSrc(`${root}/${rel}`);
  }
  // 无根目录信息：保持原样（内置主题或无法推导根目录的场景）
  return trimmed;
}

/** 合并变体的 token 分层到基础变量集合（与 applyTheme 主体口径一致） */
function mergeVariantTokens(target: Record<string, string>, tokens?: ThemeTokenLayers) {
  if (!tokens) return;
  Object.assign(
    target,
    tokens.primitive,
    tokens.semantic,
    flattenComponentTokens(tokens.component),
    tokens.motion,
    tokens.layout,
  );
}

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

export function applyTheme(theme: ThemeDefinition, options: ApplyThemeOptions = {}) {
  const root = document.documentElement;
  const { themeRoot, activeVariant } = options;
  const variant =
    activeVariant && theme.variants ? theme.variants[activeVariant] : undefined;
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

  // 叠加变体：在基础 tokens/variables 之上覆盖变体声明的 tokens/variables
  if (variant) {
    mergeVariantTokens(variables, variant.tokens);
    Object.assign(variables, variant.variables);
  }

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
    root.style.setProperty(`--${variableKey}`, cssUrl(value, themeRoot));
    dynamicThemeVariableKeys.add(variableKey);
  }

  applyThemeFonts(theme, themeRoot);

  // 3. 移除过渡 class（需等本帧绘制完成后再移除，否则过渡不触发）
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });

  // 4. 注入主题自定义 CSS（用于变量无法覆盖的深度定制：布局、图标、选择器级样式）
  //    变体的 css 追加在主题 css 之后，使其能覆盖基础样式
  let styleEl = document.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;
  const combinedCss = [theme.css, variant?.css]
    .filter((part): part is string => !!part?.trim())
    .join("\n");
  if (combinedCss.trim()) {
    // 注入前检查括号平衡，不平衡时警告（仍继续注入，浏览器会尽力解析有效部分）
    const cssError = detectCssBraceError(combinedCss);
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
    styleEl.textContent = combinedCss;
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

function cssUrl(value: string, themeRoot?: string) {
  if (/^url\(/i.test(value.trim())) return value;
  const resolved = resolveThemeAssetSrc(value, themeRoot);
  return `url(${JSON.stringify(resolved)})`;
}

function applyThemeFonts(theme: ThemeDefinition, themeRoot?: string) {
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
    .map(([family, source]) => {
      const src = resolveThemeAssetSrc(source, themeRoot);
      return `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(src)});font-display:swap;}`;
    })
    .join("\n");
}

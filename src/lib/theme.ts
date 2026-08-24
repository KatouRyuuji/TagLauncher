import type { ThemeDefinition, ThemeTokenLayers } from "../types/theme";
import { showToast } from "./toast";
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
 * 检查 CSS 字符串中大括号是否平衡（跳过字符串字面量与 /* ... *\/ 注释内容）。
 * 返回错误描述字符串，或 null（无问题）。
 */
function detectCssBraceError(css: string): string | null {
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let inComment = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inComment) {
      if (ch === "/" && css[i - 1] === "*") inComment = false;
      continue;
    }
    if (inStr) {
      if (ch === strChar) {
        // 引号前连续奇数个反斜杠才算被转义：\\" 是「转义反斜杠 + 结束引号」，
        // 只看前一字符会把结束引号误判为转义引号。
        let backslashes = 0;
        let j = i - 1;
        while (j >= 0 && css[j] === "\\") {
          backslashes++;
          j--;
        }
        if (backslashes % 2 === 0) inStr = false;
      }
      continue;
    }
    if (ch === "*" && css[i - 1] === "/") {
      inComment = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
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

/**
 * CSS 转义序列解码（用于安全检测前的归一化）。
 * CSS 允许 @\69mport、u\72l(...) 等转义写法，浏览器照常解析，
 * 若只做字面匹配，@import / url() 检查可被轻松绕过。
 */
function unescapeCss(css: string): string {
  return css.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_match, esc: string) => {
    const hexMatch = /^[0-9a-fA-F]{1,6}/.exec(esc);
    if (hexMatch) {
      const codePoint = parseInt(hexMatch[0], 16);
      // 非法码点按 U+FFFD 处理（与浏览器一致）
      if (codePoint === 0 || codePoint > 0x10ffff) return "�";
      return String.fromCodePoint(codePoint);
    }
    return esc;
  });
}

/**
 * 主题 CSS 基本消毒（仅对非内置主题 custom / mod）。纵深防御，与 CSP 配合：
 *  - 先做 CSS 转义归一化，阻止 @\69mport / u\72l() 形式的绕过；
 *  - 移除 @import：阻止 mod/自定义主题拉取远程样式表或远程字体表；
 *  - 中和指向远程 http(s) 主机或协议相对（//host）地址的 url()：阻止远程信标/追踪，
 *    替换为 url(about:blank)，但放行 Tauri asset 协议主机（asset.localhost /
 *    ipc.localhost）——主题本地字体/图片经 convertFileSrc 解析后即走该主机。
 * 保留 data: / blob: / 相对路径 / var() / asset 协议等正常写法。
 */
function sanitizeThemeCss(css: string): string {
  const normalized = unescapeCss(css);
  const withoutImport = normalized.replace(/@import\b[^;]*;?/gi, "");
  return withoutImport.replace(
    /url\(\s*(['"]?)((?:https?:\/\/|\/\/)[^)'"]*)\1\s*\)/gi,
    (match, _quote: string, rawUrl: string) => {
      // 协议相对 URL 无 scheme 可解析，直接按远程处理
      if (rawUrl.startsWith("//")) return "url(about:blank)";
      try {
        const host = new URL(rawUrl).hostname.toLowerCase();
        if (host === "asset.localhost" || host === "ipc.localhost") return match;
      } catch {
        /* URL 解析失败按远程处理，一律中和 */
      }
      return "url(about:blank)";
    },
  );
}

/**
 * 消毒单个主题变量值（非内置主题）：
 * 变量值可能夹带 url(http://远程信标)，配合 background-image: var(--x) 即可外联。
 * 复用完整 CSS 消毒口径（unescape 归一化 + 远程 url() 中和）。
 */
function sanitizeThemeVariableValue(value: string): string {
  return sanitizeThemeCss(value);
}

/**
 * 消毒 asset 值（非内置主题）。与变量值分开处理：
 * 不做 unescape 输出（保留 Windows 路径中的反斜杠，如 C:\fonts\x.woff2），
 * 仅检测 unescape 后文本是否含威胁，命中则整体中和。
 * 注意 url() 检查覆盖全部匹配：多 url 并列时只要一个指向非放行主机即整体中和，
 * 避免"首个是 asset 主机就放行整个值"的夹带绕过。
 */
function sanitizeThemeAssetValue(value: string): string {
  const normalized = unescapeCss(value).trim();
  // 协议相对裸 URL（//host/...）：继承页面协议外联，一律中和
  if (/^\/\//.test(normalized)) {
    return "about:blank";
  }
  // 裸远程 URL（asset 值直接写 https://...）
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const host = new URL(normalized).hostname.toLowerCase();
      if (host === "asset.localhost" || host === "ipc.localhost") return value;
    } catch {
      /* 解析失败按威胁处理 */
    }
    return "about:blank";
  }
  // url() 包裹的远程/协议相对 URL：逐一检查所有匹配
  const urlPattern = /url\(\s*(['"]?)((?:https?:\/\/|\/\/)[^)'"]*)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(normalized)) !== null) {
    const rawUrl = match[2];
    if (rawUrl.startsWith("//")) {
      return "url(about:blank)";
    }
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host !== "asset.localhost" && host !== "ipc.localhost") {
        return "url(about:blank)";
      }
    } catch {
      return "url(about:blank)";
    }
  }
  return value;
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
  //    非内置主题的变量值与 asset 值需消毒（可能夹带 url(http://远程信标)）。
  const sanitizeVar = theme.isPreset
    ? (v: string) => v
    : sanitizeThemeVariableValue;
  const sanitizeAsset = theme.isPreset
    ? (v: string) => v
    : sanitizeThemeAssetValue;
  for (const key of THEME_VARIABLE_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
  for (const key of dynamicThemeVariableKeys) {
    root.style.removeProperty(`--${key}`);
  }
  dynamicThemeVariableKeys.clear();
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(`--${key}`, sanitizeVar(value));
    if (!THEME_VARIABLE_KEYS.includes(key)) {
      dynamicThemeVariableKeys.add(key);
    }
  }
  for (const [key, value] of Object.entries(theme.assets ?? {})) {
    const variableKey = `asset-${key}`;
    root.style.setProperty(`--${variableKey}`, cssUrl(sanitizeAsset(value), themeRoot));
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
  const rawCombinedCss = [theme.css, variant?.css]
    .filter((part): part is string => !!part?.trim())
    .join("\n");
  // 内置主题 CSS 可信直接注入；custom / mod 主题 CSS 视为不可信，注入前基本消毒
  const combinedCss = theme.isPreset ? rawCombinedCss : sanitizeThemeCss(rawCombinedCss);
  if (combinedCss.trim()) {
    // 注入前检查括号平衡，不平衡时警告（仍继续注入，浏览器会尽力解析有效部分）
    const cssError = detectCssBraceError(combinedCss);
    if (cssError) {
      showToast(`主题 "${theme.id}" 的 CSS 存在语法问题（${cssError}），部分样式可能无效`, "warning");
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
  // 非内置主题的字体源与 assets 同一消毒口径：阻止远程字体信标
  // （@font-face 的 src 是会真实发起请求的 URL，不能绕过 sanitizeThemeAssetValue）
  const sanitizeAsset = theme.isPreset
    ? (v: string) => v
    : sanitizeThemeAssetValue;
  styleEl.textContent = Object.entries(fonts)
    .map(([family, source]) => {
      const src = sanitizeAsset(resolveThemeAssetSrc(source, themeRoot));
      return `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(src)});font-display:swap;}`;
    })
    .join("\n");
}

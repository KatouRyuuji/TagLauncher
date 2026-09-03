// ============================================================================
// themes/ryuuji.ts — RyuujiDesign 锁定色板主题工厂
// ----------------------------------------------------------------------------
// 色值逐值取自 RyuujiDesign styles/palettes.css 的锁定色板，禁止自造新色相；
// 中间档仅用 rgba/color-mix 透明度派生。结构令牌按语言分叉：
//   A = 纸面（圆角 4/8/8/12、纸影）
//   B = 仪表（直角 0/2/4/4、硬影）
// 主题模型：配色家族 × 亮/暗模式。本工厂按「家族 + 亮暗」生成具体主题，
// 家族注册表（亮暗各映射一个主题 id）见 themes/index.ts 的 THEME_FAMILIES。
// 主题唯一标识使用固定 uuid，与显示名、配色家族、功能语义完全解耦——
// 显示名是面向用户的自由文本（亮/暗两套同名），身份识别只认 uuid。
// sakura（A1 亮）为独立文件：其 uuid 已被用户配置持久化。
// 结构令牌统一走 themes/shapeLang.ts（严格对齐 lang/a.css 与 lang/b.css）。
// ============================================================================

import type { ThemeDefinition } from "../types/theme";
import { shapeLangTokens } from "./shapeLang";
import { CHROME_TOKENS } from "./chromeTokens";

interface RyuujiPalette {
  bg: string; bg_tint: string; surface: string; surface_2: string;
  border: string; border_strong: string;
  text: string; text_2: string; text_3: string; text_inverse: string;
  primary: string; primary_deep: string; primary_ink: string; signal: string;
  success: string; warning: string; danger: string;
  success_so_shallow: string; warning_so_shallow: string; danger_so_shallow: string; on_primary: string;
}

const PALETTES: Record<string, RyuujiPalette> = {
  "a1-dark": { bg: "#0e1118", bg_tint: "#2d3148", surface: "#161b25", surface_2: "#1d2431", border: "#272f3e", border_strong: "#5b6373", text: "#e8ecf4", text_2: "#a2abbd", text_3: "#6e7789", text_inverse: "#ffffff", primary: "#5d68e7", primary_deep: "#4f58c4", primary_ink: "#b6bbf4", signal: "#5d68e7", success: "#4cc295", warning: "#d4a838", danger: "#cb4754", success_so_shallow: "#213c3b", warning_so_shallow: "#3c3729", danger_so_shallow: "#3b2732", on_primary: "#ffffff" },
  "a3-light": { bg: "#faf6fe", bg_tint: "#eee3fa", surface: "#ffffff", surface_2: "#efe7fa", border: "#ddd0f0", border_strong: "#a495bb", text: "#332b40", text_2: "#564472", text_3: "#8a7aa0", text_inverse: "#ffffff", primary: "#9550e0", primary_deep: "#7f44be", primary_ink: "#683e97", signal: "#9550e0", success: "#1faa62", warning: "#e89e06", danger: "#d62a5e", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf3e1", danger_so_shallow: "#fae5ec", on_primary: "#ffffff" },
  "a3-dark": { bg: "#12101a", bg_tint: "#383047", surface: "#1a1724", surface_2: "#221e30", border: "#2d2838", border_strong: "#615971", text: "#ece7f2", text_2: "#a99cc0", text_3: "#776d8a", text_inverse: "#ffffff", primary: "#8d5ad6", primary_deep: "#784db6", primary_ink: "#d1bcee", signal: "#8d5ad6", success: "#4cc290", warning: "#d4a838", danger: "#ce4648", success_so_shallow: "#24393a", warning_so_shallow: "#3f3428", danger_so_shallow: "#3f2530", on_primary: "#ffffff" },
  "a4-light": { bg: "#f7fceb", bg_tint: "#ebf6db", surface: "#ffffff", surface_2: "#e9f4d6", border: "#d2e3b2", border_strong: "#99ad7b", text: "#2d3523", text_2: "#4a6230", text_3: "#7a9260", text_inverse: "#ffffff", primary: "#568213", primary_deep: "#496f10", primary_ink: "#4c6d19", signal: "#568213", success: "#22ab4f", warning: "#e8a006", danger: "#cb4a26", success_so_shallow: "#e4f5ea", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f9e9e5", on_primary: "#ffffff" },
  "a4-dark": { bg: "#11150f", bg_tint: "#343f23", surface: "#181d15", surface_2: "#1f251c", border: "#2a3324", border_strong: "#5c6851", text: "#e9f0e2", text_2: "#a0b28e", text_3: "#728060", text_inverse: "#ffffff", primary: "#617f26", primary_deep: "#526c20", primary_ink: "#c5df92", signal: "#617f26", success: "#52c878", warning: "#d4a838", danger: "#cd4747", success_so_shallow: "#243f29", warning_so_shallow: "#3e391c", danger_so_shallow: "#3d2821", on_primary: "#ffffff" },
  "a5-light": { bg: "#f1fcfb", bg_tint: "#daf5f6", surface: "#ffffff", surface_2: "#d9f4f2", border: "#bfe2e0", border_strong: "#87aba8", text: "#253736", text_2: "#3a5f5b", text_3: "#6a8b86", text_inverse: "#ffffff", primary: "#108289", primary_deep: "#0e6f74", primary_ink: "#176a6f", signal: "#108289", success: "#1faa64", warning: "#e8a006", danger: "#ca452c", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f9e9e6", on_primary: "#ffffff" },
  "a5-dark": { bg: "#0f1516", bg_tint: "#254141", surface: "#161e1f", surface_2: "#1c2627", border: "#273331", border_strong: "#596966", text: "#e4efee", text_2: "#9db3b0", text_3: "#6f8582", text_inverse: "#ffffff", primary: "#21827e", primary_deep: "#1c6f6b", primary_ink: "#9be6e3", signal: "#21827e", success: "#4cc290", warning: "#d4a838", danger: "#cc4851", success_so_shallow: "#213f36", warning_so_shallow: "#3c3a24", danger_so_shallow: "#3b2a2c", on_primary: "#ffffff" },
  "a6-light": { bg: "#fef4f8", bg_tint: "#fde1e8", surface: "#ffffff", surface_2: "#fae4ec", border: "#f0d4e0", border_strong: "#ba98a5", text: "#3a2a31", text_2: "#6f4453", text_3: "#9a6b78", text_inverse: "#ffffff", primary: "#e7134b", primary_deep: "#c41040", primary_ink: "#91334d", signal: "#e7134b", success: "#1faa64", warning: "#e8a006", danger: "#c0392b", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f7e7e6", on_primary: "#ffffff" },
  "a6-dark": { bg: "#141017", bg_tint: "#463039", surface: "#1c1720", surface_2: "#241e28", border: "#322733", border_strong: "#6c5b66", text: "#f0e7ec", text_2: "#bda2ac", text_3: "#8a707c", text_inverse: "#ffffff", primary: "#e61d3d", primary_deep: "#c41934", primary_ink: "#f8bdc6", signal: "#e61d3d", success: "#4cc290", warning: "#d4a838", danger: "#cd4939", success_so_shallow: "#263936", warning_so_shallow: "#413425", danger_so_shallow: "#402327", on_primary: "#ffffff" },
  "b1-light": { bg: "#eaf0fd", bg_tint: "#dadfea", surface: "#ffffff", surface_2: "#d6e0fb", border: "#ccd6f2", border_strong: "#8f9ab6", text: "#262e3e", text_2: "#3a4664", text_3: "#6a7590", text_inverse: "#ffffff", primary: "#163a7a", primary_deep: "#133168", primary_ink: "#1d3561", signal: "#3053e8", success: "#10a06a", warning: "#cf8a00", danger: "#d92538", success_so_shallow: "#e2f4ed", warning_so_shallow: "#f9f1e0", danger_so_shallow: "#fae5e7", on_primary: "#ffffff" },
  "b1-dark": { bg: "#020a19", bg_tint: "#313a4a", surface: "#081120", surface_2: "#0e1a2e", border: "#1c2c4a", border_strong: "#4e5f82", text: "#dae3fa", text_2: "#93a5cf", text_3: "#5d6d8e", text_inverse: "#ffffff", primary: "#3f70dd", primary_deep: "#365fbc", primary_ink: "#e3eafa", signal: "#3f70dd", success: "#52c878", warning: "#e0ae30", danger: "#cd4747", success_so_shallow: "#173632", warning_so_shallow: "#333023", danger_so_shallow: "#301e2a", on_primary: "#ffffff" },
  "b3-light": { bg: "#fff6f0", bg_tint: "#f8e0dd", surface: "#ffffff", surface_2: "#fae6db", border: "#f2cec2", border_strong: "#b99288", text: "#392a29", text_2: "#6a3e38", text_3: "#a07870", text_inverse: "#ffffff", primary: "#d63e2d", primary_deep: "#b63526", primary_ink: "#8c3329", signal: "#b95b05", success: "#22ab4f", warning: "#f97d0a", danger: "#c01428", success_so_shallow: "#e4f5ea", warning_so_shallow: "#feefe2", danger_so_shallow: "#f7e3e5", on_primary: "#ffffff" },
  "b3-dark": { bg: "#131010", bg_tint: "#412e2d", surface: "#1b1715", surface_2: "#241e1b", border: "#302723", border_strong: "#6a5c56", text: "#f0e8e4", text_2: "#b9a49c", text_3: "#7d6d68", text_inverse: "#ffffff", primary: "#d14338", primary_deep: "#b23930", primary_ink: "#edb5b1", signal: "#bd5908", success: "#4cc290", warning: "#f6852a", danger: "#ce4832", success_so_shallow: "#25392e", warning_so_shallow: "#472d19", danger_so_shallow: "#3f221c", on_primary: "#ffffff" }
};

interface RyuujiThemeDef {
  palette: keyof typeof PALETTES & string;
  id: string;
  name: string;
  lang: "a" | "b";
  scheme: "light" | "dark";
}

const DEFS: RyuujiThemeDef[] = [
  { palette: "a1-dark", id: "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93", name: "霜靛", lang: "a", scheme: "dark" },
  { palette: "a3-light", id: "668e5856-9d9f-481a-8f82-325372d2e256", name: "藤色", lang: "a", scheme: "light" },
  { palette: "a3-dark", id: "65596bf6-3aaf-4322-93f2-bbb60cb94b5d", name: "藤色", lang: "a", scheme: "dark" },
  { palette: "a4-light", id: "3f8ae7b3-244f-4429-a7bc-84d8bbde3ca2", name: "柳染", lang: "a", scheme: "light" },
  { palette: "a4-dark", id: "cd4665e5-081f-434b-943f-bd44b49cd6ac", name: "柳染", lang: "a", scheme: "dark" },
  { palette: "a5-light", id: "6794e521-fd01-4e6d-997a-c4d0f1c66de2", name: "水浅葱", lang: "a", scheme: "light" },
  { palette: "a5-dark", id: "f2368e2a-ee19-4192-96ea-3db85f15c74d", name: "水浅葱", lang: "a", scheme: "dark" },
  { palette: "a6-light", id: "70492696-751c-4a29-9ab4-09ad8ddff1a4", name: "樱花", lang: "a", scheme: "light" },
  { palette: "a6-dark", id: "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a", name: "樱花", lang: "a", scheme: "dark" },
  { palette: "b1-light", id: "e0f5add7-8b67-42c9-9b2b-c7bbf49e255d", name: "海军冰蓝", lang: "b", scheme: "light" },
  { palette: "b1-dark", id: "6c309a70-ec6a-4429-8299-c4cde7c0ffcc", name: "海军冰蓝", lang: "b", scheme: "dark" },
  { palette: "b3-light", id: "5298ac16-455f-42f8-8bc8-e9b03ee0fdbf", name: "铁锈", lang: "b", scheme: "light" },
  { palette: "b3-dark", id: "cfaadcb4-7e85-460c-a8fe-52e848959719", name: "铁锈", lang: "b", scheme: "dark" }
];

// 标签预设色 = 同语言同亮暗的全部 primary + 语义色，当前主题色提到首位
const TAGS: Record<string, string> = {
  "a1-dark": "#5d68e7,#e42435,#8d5ad6,#617f26,#21827e,#e61d3d,#d4a838,#4cc295",
  "a3-light": "#9550e0,#4a51e8,#e3253f,#568213,#108289,#e7134b,#e89e06,#1faa62",
  "a3-dark": "#8d5ad6,#5d68e7,#e42435,#617f26,#21827e,#e61d3d,#d4a838,#4cc290",
  "a4-light": "#568213,#4a51e8,#e3253f,#9550e0,#108289,#e7134b,#e8a006,#22ab4f",
  "a4-dark": "#617f26,#5d68e7,#e42435,#8d5ad6,#21827e,#e61d3d,#d4a838,#52c878",
  "a5-light": "#108289,#4a51e8,#e3253f,#9550e0,#568213,#e7134b,#e8a006,#1faa64",
  "a5-dark": "#21827e,#5d68e7,#e42435,#8d5ad6,#617f26,#e61d3d,#d4a838,#4cc290",
  "a6-light": "#e7134b,#4a51e8,#e3253f,#9550e0,#568213,#108289,#e8a006,#1faa64",
  "a6-dark": "#e61d3d,#5d68e7,#e42435,#8d5ad6,#617f26,#21827e,#d4a838,#4cc290",
  "b1-light": "#163a7a,#0d8198,#d63e2d,#627f0e,#cf8a00,#10a06a,#d92538,#3053e8",
  "b1-dark": "#3f70dd,#2b808e,#d14338,#637f1a,#e0ae30,#52c878,#cd4747,#8aa4ec",
  "b3-light": "#d63e2d,#163a7a,#0d8198,#627f0e,#f97d0a,#22ab4f,#c01428,#1674c8",
  "b3-dark": "#d14338,#3f70dd,#2b808e,#637f1a,#f6852a,#4cc290,#ce4832,#63a8e8"
};

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildVariables(def: RyuujiThemeDef, p: RyuujiPalette): Record<string, string> {
  const light = def.scheme === "light";
  const tags = TAGS[def.palette];
  // 星标色：B 暗色板的 signal 与 primary 不同时用 signal（仪表读数黄/橙），否则用 warning
  const favorite = !light && def.lang === "b" && p.signal !== p.primary ? p.signal : p.warning;

  return {
    // 结构令牌严格取自 RyuujiDesign 造型语言层（themes/shapeLang.ts）
    ...shapeLangTokens(def.lang, def.scheme),

    "bg-gradient": light
      ? `linear-gradient(180deg, ${p.bg} 0%, ${p.bg_tint} 100%)`
      : `linear-gradient(180deg, ${p.bg} 0%, color-mix(in srgb, ${p.bg} 92%, #000000) 100%)`,
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": `linear-gradient(180deg, ${rgba(p.primary, light ? 0.1 : 0.12)}, transparent)`,
    "media-caption-gradient": light
      ? `linear-gradient(to top, color-mix(in srgb, ${p.text} 76%, transparent), transparent)`
      : "linear-gradient(to top, rgba(0, 0, 0, 0.82), transparent)",
    "status-warning-bg": p.warning_so_shallow,
    "status-success-bg": p.success_so_shallow,
    "tag-preset-colors": tags,

    "grid-col-min": "224px",

    "bg-base": p.bg,
    "bg-surface": p.surface,
    "bg-elevated": light ? p.surface : p.surface_2,
    "bg-overlay": light ? p.surface : p.surface_2,
    "bg-hover": rgba(p.primary, light ? 0.07 : 0.1),
    "bg-active": rgba(p.primary, light ? 0.13 : 0.16),
    "bg-card": p.surface,
    "bg-card-hover": light ? p.surface : p.surface_2,
    "bg-input": light ? p.surface : p.bg,

    "text-primary": p.text,
    "text-secondary": p.text_2,
    "text-tertiary": light ? p.text_3 : rgba(p.text_2, 0.82),
    "text-muted": light ? rgba(p.text_3, 0.85) : p.text_3,
    "text-faint": rgba(p.text_3, light ? 0.62 : 0.72),
    "text-ghost": light ? p.border : rgba(p.text_3, 0.3),
    "text-placeholder": rgba(p.text_3, light ? 0.78 : 0.85),
    "text-invert": p.on_primary,

    ...(def.lang === "b" ? {
      "border-subtle": rgba(p.border_strong, light ? 0.32 : 0.35),
      "border-medium": p.border_strong,
    } : {}),
    "border-default": p.border,
    "border-strong": rgba(p.text, light ? 0.55 : 0.5),

    "accent-primary": p.primary,
    "accent-primary-hover": light
      ? `color-mix(in srgb, ${p.primary} 85%, #000000)`
      : p.primary_deep,
    "accent-primary-bg": rgba(p.primary, light ? 0.13 : 0.16),
    "accent-primary-bg-light": rgba(p.primary, light ? 0.07 : 0.09),

    "color-danger": p.danger,
    "color-danger-hover": light
      ? `color-mix(in srgb, ${p.danger} 85%, #000000)`
      : `color-mix(in srgb, ${p.danger} 85%, #ffffff)`,
    "color-danger-bg": p.danger_so_shallow,
    "color-warning": p.warning,
    "color-success": p.success,
    "color-favorite": favorite,
    "color-focus-ring": light ? p.primary : p.primary_ink,

    "overlay-bg": light ? `color-mix(in srgb, ${p.text} 34%, transparent)` : "rgba(0, 0, 0, 0.56)",
    "scrollbar-thumb": rgba(p.border_strong, 0.55),
    "scrollbar-thumb-hover": p.border_strong,

    "panel-titlebar-bg": p.surface,
    "panel-body-bg": light ? p.surface : p.bg,

    // 壳层共享令牌（z 层级/拖拽/标签透明度/边框/面板规格）
    ...CHROME_TOKENS,
  };
}

function buildTheme(def: RyuujiThemeDef): ThemeDefinition {
  const p = PALETTES[def.palette];
  return {
    id: def.id,
    name: def.name,
    author: "TagLauncher",
    version: "6.2.0",
    isPreset: true,
    lang: def.lang,
    variables: buildVariables(def, p),
    css: [
      `html { color-scheme: ${def.scheme}; }`,
      ".app-frame {",
      "  background: var(--bg-base);",
      "}",
      ...(def.lang === "a" && def.scheme === "light" ? [".text-label { color: var(--text-faint); }"] : []),
    ].join("\n"),
  };
}

export const ryuujiThemes: ThemeDefinition[] = DEFS.map(buildTheme);

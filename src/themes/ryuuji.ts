// ============================================================================
// themes/ryuuji.ts — RyuujiDesign 锁定色板主题工厂
// ----------------------------------------------------------------------------
// 色值逐值取自 RyuujiDesign styles/palettes.css 的锁定色板
// （A1–A6 纸面语言 × 亮/暗、B1–B4 仪表语言 × 亮/暗），禁止自造新色相；
// 中间档仅用 rgba/color-mix 透明度派生。结构令牌按语言分叉：
//   A = 纸面（圆角 4/6/8、纸影、MiSans + LXGW WenKai）
//   B = 仪表（直角 2/3/4、黑影、MiSans + Segoe UI）
// 三个历史内置主题（sakura=A1亮 / dark=A2暗 / cyber-cyan=B2暗）保留独立文件
// 以兼容已持久化的主题 id；其余 17 套由本工厂生成。
// ============================================================================

import type { ThemeDefinition } from "../types/theme";
import { DEFAULT_THEME_VARIABLES } from "./tokens";

interface RyuujiPalette {
  bg: string; bg_tint: string; surface: string; surface_2: string;
  border: string; border_strong: string;
  text: string; text_2: string; text_3: string; text_inverse: string;
  primary: string; primary_deep: string; signal: string;
  success: string; warning: string; danger: string;
  success_so_shallow: string; warning_so_shallow: string; danger_so_shallow: string;
}

const PALETTES: Record<string, RyuujiPalette> = {
  "a1-dark": { bg: "#0d1420", bg_tint: "#2c334f", surface: "#16202f", surface_2: "#1d2a3b", border: "#2a3850", border_strong: "#5d6a81", text: "#edf1f8", text_2: "#a3aec4", text_3: "#74809a", text_inverse: "#0d1420", primary: "#9aa3f5", primary_deep: "#b6bdf8", signal: "#9aa3f5", success: "#4dcc9a", warning: "#e2b33a", danger: "#f07a86", success_so_shallow: "#214244", warning_so_shallow: "#3f3d31", danger_so_shallow: "#423240" },
  "a2-light": { bg: "#fff7f6", bg_tint: "#f9dfe2", surface: "#ffffff", surface_2: "#f8e4e2", border: "#f0c8c6", border_strong: "#b88c8b", text: "#2a1212", text_2: "#6a3a3a", text_3: "#a06a6a", text_inverse: "#ffffff", primary: "#d93448", primary_deep: "#902631", signal: "#d93448", success: "#2f9a62", warning: "#d29a12", danger: "#9e1b30", success_so_shallow: "#e6f3ec", warning_so_shallow: "#faf3e3", danger_so_shallow: "#f3e4e6" },
  "a3-light": { bg: "#f7f3fc", bg_tint: "#ece4f6", surface: "#ffffff", surface_2: "#e8e0f4", border: "#d4c6e8", border_strong: "#9f8fb6", text: "#221833", text_2: "#564472", text_3: "#8a7aa0", text_inverse: "#ffffff", primary: "#8a58c4", primary_deep: "#5e3d87", signal: "#8a58c4", success: "#2f9a62", warning: "#d29a12", danger: "#c02a56", success_so_shallow: "#e6f3ec", warning_so_shallow: "#faf3e3", danger_so_shallow: "#f7e5eb" },
  "a3-dark": { bg: "#2a2438", bg_tint: "#4c3f60", surface: "#342c44", surface_2: "#3e3650", border: "#4a4058", border_strong: "#776a89", text: "#f3eef8", text_2: "#b5a4cc", text_3: "#7e7096", text_inverse: "#2a2438", primary: "#c4a0ec", primary_deep: "#d5bbf1", signal: "#c4a0ec", success: "#4dcc8a", warning: "#e2b33a", danger: "#f08a8a", success_so_shallow: "#394c52", warning_so_shallow: "#574742", danger_so_shallow: "#5a3f52" },
  "a4-light": { bg: "#f4fae8", bg_tint: "#eaf4de", surface: "#ffffff", surface_2: "#e2eed0", border: "#c6d9a8", border_strong: "#92a776", text: "#1c2a10", text_2: "#4a6230", text_3: "#7a9260", text_inverse: "#ffffff", primary: "#7cb82e", primary_deep: "#7cb82e", signal: "#7cb82e", success: "#2a9a4a", warning: "#d29a12", danger: "#c24a2e", success_so_shallow: "#e5f3e9", warning_so_shallow: "#faf3e3", danger_so_shallow: "#f8e9e6" },
  "a4-dark": { bg: "#243020", bg_tint: "#435430", surface: "#2c3a26", surface_2: "#364430", border: "#445438", border_strong: "#6e815d", text: "#eef6e4", text_2: "#a8be90", text_3: "#748864", text_inverse: "#243020", primary: "#b3d46a", primary_deep: "#c8e094", signal: "#b3d46a", success: "#5fd47a", warning: "#e2b33a", danger: "#f07a7a", success_so_shallow: "#365937", warning_so_shallow: "#50522a", danger_so_shallow: "#534737" },
  "a5-light": { bg: "#f2fbfa", bg_tint: "#e0f4f5", surface: "#ffffff", surface_2: "#d5f0ee", border: "#b7d9d6", border_strong: "#83a6a2", text: "#143230", text_2: "#3a5f5b", text_3: "#6a8b86", text_inverse: "#ffffff", primary: "#3db8bf", primary_deep: "#3db8bf", signal: "#3db8bf", success: "#2a9a62", warning: "#d29a12", danger: "#c2442f", success_so_shallow: "#e5f3ec", warning_so_shallow: "#faf3e3", danger_so_shallow: "#f8e9e6" },
  "a5-dark": { bg: "#1e3836", bg_tint: "#325d5b", surface: "#274440", surface_2: "#2f524e", border: "#3a5a56", border_strong: "#61817d", text: "#e7f6f4", text_2: "#97b8b4", text_3: "#6a8884", text_inverse: "#1e3836", primary: "#7ae0dc", primary_deep: "#9fe9e6", signal: "#7ae0dc", success: "#4dcc8a", warning: "#e2b33a", danger: "#f07a86", success_so_shallow: "#2f5f4f", warning_so_shallow: "#4c5a3f", danger_so_shallow: "#4f4f4e" },
  "a6-light": { bg: "#fdf3f6", bg_tint: "#f8e5eb", surface: "#ffffff", surface_2: "#f6dfe7", border: "#eccfda", border_strong: "#b895a1", text: "#38222a", text_2: "#6f4453", text_3: "#9a6b78", text_inverse: "#ffffff", primary: "#d96d90", primary_deep: "#d96d90", signal: "#d96d90", success: "#2a9a62", warning: "#d29a12", danger: "#ad2447", success_so_shallow: "#e5f3ec", warning_so_shallow: "#faf3e3", danger_so_shallow: "#f5e5e9" },
  "a6-dark": { bg: "#2e1e26", bg_tint: "#593b46", surface: "#3a2730", surface_2: "#46303a", border: "#5c3a47", border_strong: "#8c6774", text: "#f9edf1", text_2: "#cfa5b1", text_3: "#97707d", text_inverse: "#2e1e26", primary: "#f2a0b8", primary_deep: "#f6bbcc", signal: "#f2a0b8", success: "#4dcc8a", warning: "#e2b33a", danger: "#ff8a72", success_so_shallow: "#3e4842", warning_so_shallow: "#5c4332", danger_so_shallow: "#613b3d" },
  "b1-light": { bg: "#e3e9fa", bg_tint: "#dadee6", surface: "#ffffff", surface_2: "#cdd8f5", border: "#c3cdea", border_strong: "#8994b2", text: "#0a1526", text_2: "#3a4664", text_3: "#6a7590", text_inverse: "#ffffff", primary: "#1a3264", primary_deep: "#13264a", signal: "#2b4acb", success: "#1e8a5a", warning: "#b57a0a", danger: "#c22a3a", success_so_shallow: "#e4f1eb", warning_so_shallow: "#f6efe2", danger_so_shallow: "#f8e5e7" },
  "b1-dark": { bg: "#020a19", bg_tint: "#30394c", surface: "#0a1526", surface_2: "#12203a", border: "#22365c", border_strong: "#516690", text: "#d5e0ff", text_2: "#93a8d8", text_3: "#5f7196", text_inverse: "#020a19", primary: "#d5e0ff", primary_deep: "#e1e9ff", signal: "#d5e0ff", success: "#5fd47a", warning: "#f0b429", danger: "#f07a7a", success_so_shallow: "#1b3b37", warning_so_shallow: "#383527", danger_so_shallow: "#382937" },
  "b2-light": { bg: "#f0f8f9", bg_tint: "#dbeaed", surface: "#ffffff", surface_2: "#d5eaee", border: "#b7d4da", border_strong: "#83a0a7", text: "#102228", text_2: "#3a5860", text_3: "#6a888e", text_inverse: "#ffffff", primary: "#1f7a8c", primary_deep: "#195562", signal: "#e8b20a", success: "#1e9a6a", warning: "#e8b20a", danger: "#c22e1f", success_so_shallow: "#e4f3ed", warning_so_shallow: "#fcf6e2", danger_so_shallow: "#f8e6e4" },
  "b3-light": { bg: "#fff4ee", bg_tint: "#f6e1df", surface: "#ffffff", surface_2: "#f6e0d6", border: "#efc8bc", border_strong: "#b78e85", text: "#2a1210", text_2: "#6a3e38", text_3: "#a07870", text_inverse: "#ffffff", primary: "#c84438", primary_deep: "#862f27", signal: "#f07818", success: "#2a9a4a", warning: "#e8b20a", danger: "#a61e2a", success_so_shallow: "#e5f3e9", warning_so_shallow: "#fcf6e2", danger_so_shallow: "#f4e4e5" },
  "b3-dark": { bg: "#32241e", bg_tint: "#5a3e38", surface: "#3c2c26", surface_2: "#483830", border: "#5a4038", border_strong: "#876860", text: "#f8ece8", text_2: "#c4a098", text_3: "#8a6a64", text_inverse: "#32241e", primary: "#e89a94", primary_deep: "#eeb6b2", signal: "#ff8a2a", success: "#4dcc8a", warning: "#ff8a2a", danger: "#ff7a66", success_so_shallow: "#3f4c3a", warning_so_shallow: "#633f27", danger_so_shallow: "#633c33" },
  "b4-light": { bg: "#f4f6ec", bg_tint: "#f0f8dd", surface: "#ffffff", surface_2: "#e4ead6", border: "#cdd4bc", border_strong: "#969e88", text: "#161a12", text_2: "#4a5440", text_3: "#7a846c", text_inverse: "#ffffff", primary: "#9fd12a", primary_deep: "#9fd12a", signal: "#b6e04a", success: "#2a9a4a", warning: "#d29a12", danger: "#c1262e", success_so_shallow: "#e5f3e9", warning_so_shallow: "#faf3e3", danger_so_shallow: "#f8e5e6" },
  "b4-dark": { bg: "#222a22", bg_tint: "#43522b", surface: "#2a342a", surface_2: "#343e32", border: "#3a4638", border_strong: "#65735f", text: "#eef4ea", text_2: "#a0b094", text_3: "#70806a", text_inverse: "#222a22", primary: "#b6e04a", primary_deep: "#cae97d", signal: "#c8ec6a", success: "#5fd47a", warning: "#e2b33a", danger: "#f06a6a", success_so_shallow: "#35543a", warning_so_shallow: "#4f4d2d", danger_so_shallow: "#523f37" }
};

interface RyuujiThemeDef {
  palette: keyof typeof PALETTES & string;
  id: string;
  name: string;
  lang: "a" | "b";
  scheme: "light" | "dark";
}

const DEFS: RyuujiThemeDef[] = [
  { palette: "a1-dark", id: "ryuuji-a1-dark", name: "深色·夜航", lang: "a", scheme: "dark" },
  { palette: "a2-light", id: "ryuuji-a2-light", name: "亮色·茜纸", lang: "a", scheme: "light" },
  { palette: "a3-light", id: "ryuuji-a3-light", name: "亮色·紫苑", lang: "a", scheme: "light" },
  { palette: "a3-dark", id: "ryuuji-a3-dark", name: "深色·夜紫", lang: "a", scheme: "dark" },
  { palette: "a4-light", id: "ryuuji-a4-light", name: "亮色·苔纸", lang: "a", scheme: "light" },
  { palette: "a4-dark", id: "ryuuji-a4-dark", name: "深色·苔原", lang: "a", scheme: "dark" },
  { palette: "a5-light", id: "ryuuji-a5-light", name: "亮色·青瓷", lang: "a", scheme: "light" },
  { palette: "a5-dark", id: "ryuuji-a5-dark", name: "深色·渊青", lang: "a", scheme: "dark" },
  { palette: "a6-light", id: "ryuuji-a6-light", name: "亮色·樱纸", lang: "a", scheme: "light" },
  { palette: "a6-dark", id: "ryuuji-a6-dark", name: "深色·夜樱", lang: "a", scheme: "dark" },
  { palette: "b1-light", id: "ryuuji-b1-light", name: "亮色·海图", lang: "b", scheme: "light" },
  { palette: "b1-dark", id: "ryuuji-b1-dark", name: "深色·夜海", lang: "b", scheme: "dark" },
  { palette: "b2-light", id: "ryuuji-b2-light", name: "亮色·浅滩", lang: "b", scheme: "light" },
  { palette: "b3-light", id: "ryuuji-b3-light", name: "亮色·旭日", lang: "b", scheme: "light" },
  { palette: "b3-dark", id: "ryuuji-b3-dark", name: "深色·熔岩", lang: "b", scheme: "dark" },
  { palette: "b4-light", id: "ryuuji-b4-light", name: "亮色·青柠", lang: "b", scheme: "light" },
  { palette: "b4-dark", id: "ryuuji-b4-dark", name: "深色·荧光", lang: "b", scheme: "dark" }
];

// 标签预设色 = 同语言同亮暗的全部 primary + 语义色，当前主题色提到首位
const TAG_SETS: Record<"a-light" | "a-dark" | "b-light" | "b-dark", string[]> = {
  "a-light": ["#5157d8", "#d93448", "#8a58c4", "#7cb82e", "#3db8bf", "#d96d90", "#d88a1d", "#16815f"],
  "a-dark": ["#9aa3f5", "#f07a86", "#c4a0ec", "#b3d46a", "#7ae0dc", "#f2a0b8", "#e2b33a", "#4dcc8a"],
  "b-light": ["#1a3264", "#1f7a8c", "#c84438", "#9fd12a", "#1e8a5a", "#b57a0a", "#c22a3a", "#2b4acb"],
  "b-dark": ["#d5e0ff", "#6ec8d6", "#e89a94", "#b6e04a", "#5fd47a", "#f0b429", "#f07a7a", "#8fa8f0"],
};

const FONT_A = "\"MiSans\", \"LXGW WenKai\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"Microsoft YaHei UI\", sans-serif";
const FONT_B = "\"MiSans\", \"Segoe UI Variable Text\", \"PingFang SC\", \"HarmonyOS Sans SC\", \"Microsoft YaHei UI\", sans-serif";
const FONT_MONO = "\"JetBrains Mono\", \"Cascadia Mono\", monospace";

const SHADOW_LIGHT: Record<string, string> = {
  "shadow-sm": "0 1px 1px rgba(40, 58, 75, 0.05), 0 5px 16px rgba(40, 58, 75, 0.035)",
  "shadow-md": "0 1px 1px rgba(40, 58, 75, 0.06), 0 10px 28px rgba(40, 58, 75, 0.07)",
  "shadow-lg": "0 2px 3px rgba(40, 58, 75, 0.08), 0 18px 48px rgba(40, 58, 75, 0.1)",
  "shadow-overlay": "0 2px 4px rgba(40, 58, 75, 0.08), 0 24px 70px rgba(40, 58, 75, 0.16)",
  "shadow-dropdown": "0 2px 3px rgba(40, 58, 75, 0.08), 0 14px 36px rgba(40, 58, 75, 0.12)",
  "shadow-card": "0 1px 1px rgba(40, 58, 75, 0.04), 0 6px 18px rgba(40, 58, 75, 0.04)",
  "shadow-glow": "none",
};
const SHADOW_DARK: Record<string, string> = {
  "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.28)",
  "shadow-md": "0 2px 8px rgba(0, 0, 0, 0.32)",
  "shadow-lg": "0 4px 16px rgba(0, 0, 0, 0.38)",
  "shadow-overlay": "0 8px 24px rgba(0, 0, 0, 0.46)",
  "shadow-dropdown": "0 4px 16px rgba(0, 0, 0, 0.36)",
  "shadow-card": "0 1px 3px rgba(0, 0, 0, 0.26)",
  "shadow-glow": "none",
};

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildVariables(def: RyuujiThemeDef, p: RyuujiPalette): Record<string, string> {
  const light = def.scheme === "light";
  const tags = [...TAG_SETS[`${def.lang}-${def.scheme}`]];
  const first = tags.indexOf(p.primary);
  if (first > 0) tags.unshift(...tags.splice(first, 1));
  // 星标色：B 暗色板的 signal 与 primary 不同时用 signal（仪表读数黄/橙），否则用 warning
  const favorite = !light && def.lang === "b" && p.signal !== p.primary ? p.signal : p.warning;

  return {
    ...DEFAULT_THEME_VARIABLES,

    "font-family": def.lang === "a" ? FONT_A : FONT_B,
    "font-family-mono": FONT_MONO,
    "letter-spacing": "0",

    "radius-sm": def.lang === "a" ? "4px" : "2px",
    "radius-md": def.lang === "a" ? "6px" : "3px",
    "radius-lg": def.lang === "a" ? "8px" : "4px",
    "radius-xl": def.lang === "a" ? "8px" : "4px",

    ...(light ? SHADOW_LIGHT : SHADOW_DARK),

    "transition-fast": def.lang === "a" ? "150ms cubic-bezier(0.22, 0.8, 0.24, 1)" : "140ms cubic-bezier(0.2, 0.8, 0.2, 1)",
    "transition-normal": def.lang === "a" ? "240ms cubic-bezier(0.22, 0.8, 0.24, 1)" : "220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
    "transition-slow": def.lang === "a" ? "380ms cubic-bezier(0.22, 0.8, 0.24, 1)" : "360ms cubic-bezier(0.2, 0.8, 0.2, 1)",

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
    "tag-preset-colors": tags.join(","),

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
    "text-invert": p.text_inverse,

    "border-subtle": rgba(p.border_strong, light ? 0.32 : 0.35),
    "border-default": p.border,
    "border-medium": p.border_strong,
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

    "overlay-bg": light ? `color-mix(in srgb, ${p.text} 34%, transparent)` : "rgba(0, 0, 0, 0.56)",
    "scrollbar-thumb": rgba(p.border_strong, 0.55),
    "scrollbar-thumb-hover": p.border_strong,

    "panel-titlebar-bg": p.surface,
    "panel-body-bg": light ? p.surface : p.bg,
  };
}

function buildTheme(def: RyuujiThemeDef): ThemeDefinition {
  const p = PALETTES[def.palette];
  return {
    id: def.id,
    name: def.name,
    author: "TagLauncher",
    version: "5.1.0",
    isPreset: true,
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

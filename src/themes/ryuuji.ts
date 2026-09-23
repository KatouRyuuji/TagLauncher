// ============================================================================
// themes/ryuuji.ts — 内置色板主题工厂
// ----------------------------------------------------------------------------
// 内置主题分别定义纸面冷暖、文字墨色、强调色与标签色板。
// 主题按「配色家族 × 亮暗模式」生成；结构层级和交互控件在各主题间保持一致。
// 主题模型：配色家族 × 亮/暗模式。本工厂按「家族 + 亮暗」生成具体主题，
// 家族注册表（亮暗各映射一个主题 id）见 themes/index.ts 的 THEME_FAMILIES。
// 主题唯一标识使用固定 uuid，与显示名、配色家族、功能语义完全解耦——
// 显示名是面向用户的自由文本（亮/暗两套同名），身份识别只认 uuid。
// sakura（霜靛·亮）为独立文件：其 uuid 已被用户配置持久化。
// 素墨使用中性强调色；结构令牌统一走 themes/shapeLang.ts。
// ============================================================================

import type { ThemeDefinition } from "../types/theme";
import { shapeLangTokens } from "./shapeLang";
import { CHROME_TOKENS } from "./chromeTokens";

interface RyuujiPalette {
  bg: string; bg_tint: string; surface: string; surface_2: string;
  border: string; border_strong: string;
  text: string; text_2: string; text_3: string; text_inverse: string;
  primary: string; primary_deep: string; primary_ink: string; primary_shallow: string;
  primary_so_shallow: string; primary_soo_shallow: string;
  on_primary: string; signal: string;
  success: string; warning: string; danger: string; info: string;
  success_ink: string; warning_ink: string; danger_ink: string; info_ink: string;
  success_fill: string; warning_fill: string;
  success_so_shallow: string; warning_so_shallow: string; danger_so_shallow: string; info_so_shallow: string;
}

const PALETTES: Record<string, RyuujiPalette> = {
  "a1-dark": { bg: "#10131c", bg_tint: "#1c202d", surface: "#212a3a", surface_2: "#2c3547", border: "#272f3e", border_strong: "#5b6373", text: "#e8ecf4", text_2: "#aeb8c9", text_3: "#8f99aa", text_inverse: "#ffffff", primary: "#4f6aeb", primary_deep: "#435ac8", primary_ink: "#bec8f8", primary_shallow: "#7b86b8", primary_so_shallow: "#2d3346", primary_soo_shallow: "#1c202d", on_primary: "#ffffff", signal: "#4f6aeb", success: "#4cc295", warning: "#d4a838", danger: "#cb4754", info: "#48beb8", success_ink: "#4cc295", warning_ink: "#d4a838", danger_ink: "#d97881", info_ink: "#48beb8", success_fill: "#2d8463", warning_fill: "#91711f", success_so_shallow: "#213c3b", warning_so_shallow: "#3c3729", danger_so_shallow: "#3b2732", info_so_shallow: "#203c42" },
  "a3-light": { bg: "#f5f0fa", bg_tint: "#f0e9f7", surface: "#ffffff", surface_2: "#eee5f5", border: "#ddd0f0", border_strong: "#a495bb", text: "#332b40", text_2: "#4e3d67", text_3: "#665475", text_inverse: "#ffffff", primary: "#8f5fc5", primary_deep: "#7a51a7", primary_ink: "#6b4d8e", primary_shallow: "#b899da", primary_so_shallow: "#f4f0f9", primary_soo_shallow: "#f0e9f7", on_primary: "#ffffff", signal: "#8f5fc5", success: "#1faa62", warning: "#e89e06", danger: "#d62a5e", info: "#4a77f0", success_ink: "#167745", warning_ink: "#8c5f04", danger_ink: "#c42655", info_ink: "#255aed", success_fill: "#18864d", warning_fill: "#9e6c04", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf3e1", danger_so_shallow: "#fae5ec", info_so_shallow: "#e9effd" },
  // 藤色暗：primary 向暖紫（梅紫方向）推 ~12°，与霜靛暗的冷靛拉开色相距离
  "a3-dark": { bg: "#131119", bg_tint: "#24202c", surface: "#2b2736", surface_2: "#353140", border: "#332f3b", border_strong: "#615971", text: "#ece7f2", text_2: "#b4a8ca", text_3: "#978fa9", text_inverse: "#ffffff", primary: "#a855d1", primary_deep: "#8f47bd", primary_ink: "#e2c9f6", primary_shallow: "#9680b0", primary_so_shallow: "#393444", primary_soo_shallow: "#24202c", on_primary: "#ffffff", signal: "#a855d1", success: "#4cc290", warning: "#deb44e", danger: "#ce4648", info: "#8ba4e6", success_ink: "#4cc290", warning_ink: "#deb44e", danger_ink: "#db7778", info_ink: "#8ba4e6", success_fill: "#2d845f", warning_fill: "#91711f", success_so_shallow: "#24393a", warning_so_shallow: "#3f3428", danger_so_shallow: "#3f2530", info_so_shallow: "#31334b" },
  "a4-light": { bg: "#f1f6e9", bg_tint: "#ebf2e0", surface: "#ffffff", surface_2: "#e8efdc", border: "#d2e3b2", border_strong: "#99ad7b", text: "#2d3523", text_2: "#4a6230", text_3: "#5e704a", text_inverse: "#ffffff", primary: "#578129", primary_deep: "#4a6e23", primary_ink: "#53762d", primary_shallow: "#a4c97b", primary_so_shallow: "#f1f7eb", primary_soo_shallow: "#ebf2e0", on_primary: "#ffffff", signal: "#578129", success: "#22ab4f", warning: "#e8a006", danger: "#cb4a26", info: "#1f8ad8", success_ink: "#197a38", warning_ink: "#8e6204", danger_ink: "#b94323", info_ink: "#196ead", success_fill: "#1b873e", warning_fill: "#9c6c04", success_so_shallow: "#e4f5ea", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f9e9e5", info_so_shallow: "#e4f1fa" },
  "a4-dark": { bg: "#12170e", bg_tint: "#1f2617", surface: "#1a2113", surface_2: "#222a18", border: "#2d3a20", border_strong: "#637648", text: "#eef4de", text_2: "#aec97f", text_3: "#83a05e", text_inverse: "#ffffff", primary: "#5d8029", primary_deep: "#4f6d23", primary_ink: "#c8e1a4", primary_shallow: "#86a160", primary_so_shallow: "#323e24", primary_soo_shallow: "#1f2617", on_primary: "#ffffff", signal: "#5d8029", success: "#52c878", warning: "#d4a838", danger: "#cd4747", info: "#6aa8e8", success_ink: "#52c878", warning_ink: "#d4a838", danger_ink: "#db7c7c", info_ink: "#6aa8e8", success_fill: "#2b8648", warning_fill: "#91711f", success_so_shallow: "#254227", warning_so_shallow: "#3f3c1a", danger_so_shallow: "#3e2b20", info_so_shallow: "#2a3c3e" },
  "a5-light": { bg: "#eaf6f5", bg_tint: "#dff1f1", surface: "#ffffff", surface_2: "#dcefed", border: "#bfe2e0", border_strong: "#87aba8", text: "#253736", text_2: "#3a5f5b", text_3: "#556e6a", text_inverse: "#ffffff", primary: "#12828a", primary_deep: "#0f6f75", primary_ink: "#1c7176", primary_shallow: "#65bdc3", primary_so_shallow: "#e8f5f6", primary_soo_shallow: "#dff1f1", on_primary: "#ffffff", signal: "#12828a", success: "#1faa64", warning: "#e8a006", danger: "#ca452c", info: "#1f8ad8", success_ink: "#167947", warning_ink: "#8d6104", danger_ink: "#ba4029", info_ink: "#196eac", success_fill: "#18864f", warning_fill: "#9c6c04", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f9e9e6", info_so_shallow: "#e4f1fa" },
  "a5-dark": { bg: "#0f1516", bg_tint: "#182425", surface: "#161e1f", surface_2: "#1c2627", border: "#273331", border_strong: "#596966", text: "#e4efee", text_2: "#9db3b0", text_3: "#7b908d", text_inverse: "#ffffff", primary: "#2e817e", primary_deep: "#276e6b", primary_ink: "#a6dfdd", primary_shallow: "#639e9c", primary_so_shallow: "#273b3b", primary_soo_shallow: "#182425", on_primary: "#ffffff", signal: "#2e817e", success: "#4cc290", warning: "#d4a838", danger: "#cc4851", info: "#6aa8e8", success_ink: "#4cc290", warning_ink: "#d4a838", danger_ink: "#da7b80", info_ink: "#6aa8e8", success_fill: "#2d845f", warning_fill: "#91711f", success_so_shallow: "#213f36", warning_so_shallow: "#3c3a24", danger_so_shallow: "#3b2a2c", info_so_shallow: "#273a47" },
  // 樱花主题以低饱和玫瑰色作为强调色，工作区表面仍保持中性。
  "a6-light": { bg: "#fcf6f8", bg_tint: "#faf1f4", surface: "#ffffff", surface_2: "#f5e2ea", border: "#f4d3e1", border_strong: "#c692a4", text: "#42232e", text_2: "#7c3548", text_3: "#8c4259", text_inverse: "#ffffff", primary: "#c94578", primary_deep: "#a93d66", primary_ink: "#8d3f5d", primary_shallow: "#e39eb9", primary_so_shallow: "#fbf0f4", primary_soo_shallow: "#f9eaf1", on_primary: "#ffffff", signal: "#c94578", success: "#1faa64", warning: "#e8a006", danger: "#c0392b", info: "#1f8ad8", success_ink: "#167645", warning_ink: "#895f04", danger_ink: "#bb382a", info_ink: "#186ba7", success_fill: "#18864f", warning_fill: "#9c6c04", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f7e7e6", info_so_shallow: "#e4f1fa" },
  "a6-dark": { bg: "#161013", bg_tint: "#271d21", surface: "#2e2229", surface_2: "#392a32", border: "#35252d", border_strong: "#765a64", text: "#f4e9ed", text_2: "#dab0bc", text_3: "#b08a97", text_inverse: "#ffffff", primary: "#d93461", primary_deep: "#b82c52", primary_ink: "#f4c5d2", primary_shallow: "#b38290", primary_so_shallow: "#412e35", primary_soo_shallow: "#271d21", on_primary: "#ffffff", signal: "#d93461", success: "#4cc290", warning: "#e2b851", danger: "#cd4939", info: "#6aa8e8", success_ink: "#4cc290", warning_ink: "#e2b851", danger_ink: "#da776b", info_ink: "#6aa8e8", success_fill: "#2d845f", warning_fill: "#91711f", success_so_shallow: "#293832", warning_so_shallow: "#443321", danger_so_shallow: "#432223", info_so_shallow: "#2f3344" },
  "b1-light": { bg: "#eaf0f9", bg_tint: "#e0e8f3", surface: "#ffffff", surface_2: "#dee7f3", border: "#ccd6f2", border_strong: "#8f9ab6", text: "#262e3e", text_2: "#3a4664", text_3: "#5d667e", text_inverse: "#ffffff", primary: "#244e7b", primary_deep: "#1f4269", primary_ink: "#254161", primary_shallow: "#6e8aa8", primary_so_shallow: "#e9edf2", primary_soo_shallow: "#e0e8f3", on_primary: "#ffffff", signal: "#386bce", success: "#10a06a", warning: "#cf8a00", danger: "#d92538", info: "#386bce", success_ink: "#0b754e", warning_ink: "#8c5d00", danger_ink: "#c62233", info_ink: "#3062c4", success_fill: "#0d8659", warning_fill: "#a06b00", success_so_shallow: "#e2f4ed", warning_so_shallow: "#f9f1e0", danger_so_shallow: "#fae5e7", info_so_shallow: "#e7edf9" },
  "b1-dark": { bg: "#0b1320", bg_tint: "#192231", surface: "#131e2d", surface_2: "#1a293b", border: "#2c3d55", border_strong: "#576988", text: "#dae3fa", text_2: "#93a5cf", text_3: "#8190ac", text_inverse: "#ffffff", primary: "#2475d5", primary_deep: "#1f63b5", primary_ink: "#ccdff6", primary_shallow: "#889db8", primary_so_shallow: "#2d3b4d", primary_soo_shallow: "#192231", on_primary: "#ffffff", signal: "#2475d5", success: "#52c878", warning: "#e0ae30", danger: "#cd4747", info: "#8aa4ec", success_ink: "#52c878", warning_ink: "#e0ae30", danger_ink: "#da7979", info_ink: "#8aa4ec", success_fill: "#2b8648", warning_fill: "#947016", success_so_shallow: "#20403c", warning_so_shallow: "#3c3b2e", danger_so_shallow: "#392834", info_so_shallow: "#2b3953" },
  "b3-light": { bg: "#fbefe8", bg_tint: "#f8e7df", surface: "#ffffff", surface_2: "#f1dfd4", border: "#f2cec2", border_strong: "#b99288", text: "#392a29", text_2: "#6a3e38", text_3: "#7f5c54", text_inverse: "#ffffff", primary: "#b8513d", primary_deep: "#9c4534", primary_ink: "#834135", primary_shallow: "#d08c7f", primary_so_shallow: "#f8eeec", primary_soo_shallow: "#f8e7df", on_primary: "#ffffff", signal: "#b55e21", success: "#22ab4f", warning: "#cd6b25", danger: "#c01428", info: "#1674c8", success_ink: "#177335", warning_ink: "#9a511c", danger_ink: "#c01428", info_ink: "#1366b1", success_fill: "#1b873e", warning_fill: "#b55e21", success_so_shallow: "#e4f5ea", warning_so_shallow: "#f9ede5", danger_so_shallow: "#f7e3e5", info_so_shallow: "#e3eef8" },
  "b3-dark": { bg: "#131010", bg_tint: "#241c1a", surface: "#1b1715", surface_2: "#241e1b", border: "#302723", border_strong: "#6a5c56", text: "#f0e8e4", text_2: "#b9a49c", text_3: "#93847e", text_inverse: "#ffffff", primary: "#c35332", primary_deep: "#a6472b", primary_ink: "#ebbdb0", primary_shallow: "#a97b6d", primary_so_shallow: "#3b2e29", primary_soo_shallow: "#241c1a", on_primary: "#ffffff", signal: "#b65e19", success: "#4cc290", warning: "#eaa066", danger: "#ce4832", info: "#63a8e8", success_ink: "#4cc290", warning_ink: "#eaa066", danger_ink: "#d97564", info_ink: "#63a8e8", success_fill: "#2d845f", warning_fill: "#b65e19", success_so_shallow: "#25392e", warning_so_shallow: "#443225", danger_so_shallow: "#3f221c", info_so_shallow: "#29343f" },
  // 素墨（mono）：A/B 共享的中性灰板，色值与语言无关，两语言仅造型分叉
  // 素墨（mono）：A/B 共享的中性灰板，色值与语言无关，两语言仅造型分叉。
  // 去色只作用 UI 装饰色（评审裁定）：警告/危险/成功语义色保留彩色，失效信号不隐身；
  // 暗色卡片 surface 抬 6% 明度增强浮层感（第三轮评审：暗色面层级阶梯过扁）。
  "mono-light": { bg: "#f5f5f5", bg_tint: "#ebebeb", surface: "#ffffff", surface_2: "#ebebeb", border: "#dedede", border_strong: "#a3a3a3", text: "#202020", text_2: "#4b4b4b", text_3: "#5e5e5e", text_inverse: "#ffffff", primary: "#242424", primary_deep: "#1f1f1f", primary_ink: "#222222", primary_shallow: "#6e6e6e", primary_so_shallow: "#e9e9e9", primary_soo_shallow: "#ebebeb", on_primary: "#ffffff", signal: "#242424", success: "#1faa64", warning: "#e8a006", danger: "#c0392b", info: "#686868", success_ink: "#167645", warning_ink: "#895f04", danger_ink: "#bb382a", info_ink: "#686868", success_fill: "#18864f", warning_fill: "#9c6c04", success_so_shallow: "#e4f5ec", warning_so_shallow: "#fcf4e1", danger_so_shallow: "#f7e7e6", info_so_shallow: "#ededed" },
  // 暗色卡片 surface 抬 6% 明度（第三轮评审：暗色面层级阶梯过扁，素墨最明显）
  "mono-dark": { bg: "#101010", bg_tint: "#212121", surface: "#2b2b2b", surface_2: "#363636", border: "#343434", border_strong: "#6a6a6a", text: "#ededed", text_2: "#bdbdbd", text_3: "#9c9c9c", text_inverse: "#ffffff", primary: "#e5e5e5", primary_deep: "#ececec", primary_ink: "#ececec", primary_shallow: "#a9a9a9", primary_so_shallow: "#3a3a3a", primary_soo_shallow: "#212121", on_primary: "#101010", signal: "#e5e5e5", success: "#52c878", warning: "#d4a838", danger: "#cd4747", info: "#a7a7a7", success_ink: "#52c878", warning_ink: "#d4a838", danger_ink: "#da7c7c", info_ink: "#a7a7a7", success_fill: "#2b8648", warning_fill: "#91711f", success_so_shallow: "#254227", warning_so_shallow: "#3f3c1a", danger_so_shallow: "#3e2b20", info_so_shallow: "#353535" },
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
  { palette: "a6-light", id: "70492696-751c-4a29-9ab4-09ad8ddff1a4", name: "樱花", lang: "a", scheme: "light" },
  { palette: "a6-dark", id: "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a", name: "樱花", lang: "a", scheme: "dark" },
  { palette: "mono-light", id: "f04d4499-8a9c-4c84-b7d1-73574fc98f9e", name: "素墨", lang: "a", scheme: "light" },
  { palette: "mono-dark", id: "2db7495f-a084-4f7d-ae6d-d06258dc0e3c", name: "素墨", lang: "a", scheme: "dark" },
];

// 色位顺序跨主题固定：蓝、紫、玫瑰、石墨、金、绿、陶土、青、赤、棕。
// 每个主题分别调配墨色；浅底只承载文字，辨识由墨色承担。
const TAGS: Record<string, string> = {
  "a1-dark": "#95b4ed,#c6a1e2,#e1a0b8,#b9c0ca,#dcc17e,#94c6a4,#e3ad87,#8ac8ca,#e6a298,#c6ac8c",
  "a3-light": "#46678e,#795493,#985777,#625b68,#857035,#47734f,#9e613d,#327b78,#a25050,#7c5b44",
  "a3-dark": "#a0b9df,#c5a5df,#dfa7c4,#c1b8c7,#d5c189,#a1c69e,#dfb393,#95c9c0,#dfa6a3,#cbb092",
  "a6-light": "#4c6595,#855397,#a43f60,#6b5f64,#917124,#42784e,#ad5839,#347d7f,#ad4e45,#825c43",
  "a6-dark": "#a6b9e5,#cba5db,#eca3b8,#c8b9c0,#dfc284,#a1c9a7,#e8af96,#9bcdcf,#e9a194,#c9ad96",
  "mono-light": "#47658b,#775889,#96586d,#575d64,#89712d,#48755b,#986342,#347979,#96574e,#765e47",
  "mono-dark": "#a0b7d6,#c0a7d0,#d7a7b8,#bec6ca,#d0c08c,#a1c5ae,#d5b296,#97c4c4,#d3a59d,#c5b196"
};

const FAMILY_SURFACES: Record<string, [string, string, string, string, string, string]> = {
  "a1-dark": ["#171c24", "#202733", "#29323f", "#e4eaf2", "#bec8d6", "#96a4b8"],
  "a3-light": ["#f8f6f3", "#fffdf9", "#fffdf9", "#382f3a", "#625765", "#786c78"],
  "a3-dark": ["#211d24", "#2b252e", "#342d39", "#efe6ec", "#cec0cf", "#ac9db0"],
  "a6-light": ["#faf6f5", "#fffdfb", "#fffdfb", "#3b3032", "#66585b", "#7b6b70"],
  "a6-dark": ["#221d20", "#2b2529", "#372c32", "#f1e7ec", "#d2c1c7", "#b09da6"],
  "mono-light": ["#f5f5f3", "#fdfdfb", "#fdfdfb", "#292b2a", "#535956", "#67716b"],
  "mono-dark": ["#191b1b", "#242728", "#2d3132", "#e7ebea", "#c1c8c6", "#9ca8a4"],
};

const FAMILY_ACCENTS: Record<string, string> = {
  "a1-dark": "#8190b9",
  "a3-light": "#6f647a",
  "a3-dark": "#9f95b0",
  "a6-light": "#956d77",
  "a6-dark": "#b58c96",
  "mono-light": "#50565c",
  "mono-dark": "#d0d3d8",
};

// 素墨纪律：中性板不染色，影一律近黑（亮场把 A/B 的带色影换成中性黑影）
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildVariables(def: RyuujiThemeDef, p: RyuujiPalette): Record<string, string> {
  const light = def.scheme === "light";
  const tags = TAGS[def.palette];
  const primary = FAMILY_ACCENTS[def.palette] ?? p.primary;
  const [paper, paperSurface, raisedSurface, textPrimary, textSecondary, textMuted] = FAMILY_SURFACES[def.palette];
  const neutralBorder = light ? "#e7e8e3" : "#343940";
  const neutralBorderStrong = light ? "#c9ccc5" : "#4d545e";
  const favorite = primary;

  return {
    // 结构令牌统一走造型语言层（themes/shapeLang.ts）
    ...shapeLangTokens(def.lang, def.scheme),
    "bg-gradient": paper,
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": `linear-gradient(180deg, ${rgba(primary, light ? 0.08 : 0.1)}, transparent)`,
    "media-caption-gradient": light
      ? `linear-gradient(to top, color-mix(in srgb, ${p.text} 76%, transparent), transparent)`
      : "linear-gradient(to top, rgba(0, 0, 0, 0.82), transparent)",
    "status-warning-bg": p.warning_so_shallow,
    "status-success-bg": p.success_so_shallow,
    "color-success-ink": p.success_ink,
    "color-warning-ink": p.warning_ink,
    "color-info-ink": p.info_ink,
    "tag-preset-colors": tags,

    "grid-col-min": "256px",

    "bg-base": paper,
    // B 暗色深场层次：面板沉入场底（surface := bg），浮层台阶由 surface-2 承担
    "bg-surface": paperSurface,
    "bg-elevated": raisedSurface,
    "bg-overlay": raisedSurface,
    "bg-hover": `color-mix(in srgb, ${textPrimary} ${light ? 5 : 7}%, ${paperSurface})`,
    "bg-active": rgba(primary, light ? 0.08 : 0.16),
    "bg-card": paperSurface,
    "bg-card-hover": raisedSurface,
    "bg-input": paperSurface,
    "bg-input-hover": raisedSurface,

    "text-primary": textPrimary,
    "text-secondary": textSecondary,
    "text-tertiary": textMuted,
    "text-muted": textMuted,
    "text-faint": textMuted,
    "text-ghost": light ? "#c3c9c0" : "#555c66",
    "text-placeholder": textMuted,
    "text-invert": p.on_primary,

    "border-subtle": neutralBorder,
    "border-medium": neutralBorderStrong,
    "border-default": neutralBorder,
    "border-strong": neutralBorderStrong,

    "accent-primary": primary,
    "accent-primary-hover": `color-mix(in srgb, ${primary} 94%, #000000)`,
    "accent-primary-bg": rgba(primary, light ? 0.1 : 0.18),
    "accent-primary-bg-light": rgba(primary, light ? 0.06 : 0.1),
    "accent-primary-ink": `color-mix(in srgb, ${primary} 80%, ${textPrimary})`,
    "accent-primary-shallow": p.primary_shallow,
    // 信号色：B 仪器焦点/当前项通道色（与 primary 可不同）；A 与 primary 同色
    "accent-signal": primary,

    "row-selected-bg": rgba(primary, light ? 0.12 : 0.22),
    "row-selected-fg": textPrimary,
    "row-selected-sub-fg": textSecondary,
    "row-selected-shadow": "none",
    "row-selected-weight": "600",

    "color-danger": p.danger,
    "color-on-danger": "#ffffff",
    "color-danger-hover": `color-mix(in srgb, ${p.danger} 96%, #000000)`,
    "color-danger-bg": p.danger_so_shallow,
    "color-danger-ink": p.danger_ink,
    "color-warning": p.warning,
    "color-success": p.success,
    "color-favorite": favorite,
    // 键盘焦点环：A = primary（暗色换 primary-ink 提亮）；B 仪器焦点 = signal 通道色
    "color-focus-ring": primary,

    "overlay-bg": light ? "rgba(24, 28, 34, 0.42)" : "rgba(0, 0, 0, 0.56)",
    "scrollbar-thumb": neutralBorderStrong,
    "scrollbar-thumb-hover": textMuted,

    "panel-titlebar-bg": paperSurface,
    "panel-body-bg": paperSurface,

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
    version: "7.0.0",
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

// ============================================================================
// themes/ryuuji.ts — 内置色板主题工厂
// ----------------------------------------------------------------------------
// 内置主题色值集中维护于本文件 PALETTES 表（每板含完整语义色阶：
// bg/surface/border/text×3/primary 梯度/on-primary/signal/语义四色及 ink/fill/
// 浅染档），禁止自造新色相；中间档仅用 rgba/color-mix 透明度派生。
// 结构令牌按语言分叉：
//   A = 纸面（圆角 6/10/14/18、双层软影 + 顶唇）
//   B = 仪表（直角 0/2/4/4、硬影 + 双线内框，暗色面板沉入场底 surface:=bg）
// 主题模型：配色家族 × 亮/暗模式。本工厂按「家族 + 亮暗」生成具体主题，
// 家族注册表（亮暗各映射一个主题 id）见 themes/index.ts 的 THEME_FAMILIES。
// 主题唯一标识使用固定 uuid，与显示名、配色家族、功能语义完全解耦——
// 显示名是面向用户的自由文本（亮/暗两套同名），身份识别只认 uuid。
// sakura（霜靛·亮）为独立文件：其 uuid 已被用户配置持久化。
// 素墨为 A/B 共享中性色板：色值两语言一致，仅造型语言不同。
// 结构令牌统一走 themes/shapeLang.ts（A/B 双语言结构配方）。
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
  // 樱花亮：画布降饱和（bg/bg_tint 提亮去粉压 + PAPER_BIAS.paper 减半），大片空场不刺眼
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

// 标签预设色 = 同语言同亮暗的全部 primary（评审调优：素墨也用彩色——标签色是
// 用户数据的识别维度，不随素墨 UI 去色纪律抹掉）+ 语义色，当前主题色提到首位
const TAGS: Record<string, string> = {
  "a1-dark": "#4f6aeb,#a855d1,#d93461,#e5e5e5,#d4a838,#4cc295,#fb923c,#38bdf8",
  "a3-light": "#8f5fc5,#5064d8,#d63865,#242424,#e89e06,#1faa62,#ea580c,#1f8ad8",
  "a3-dark": "#a855d1,#4f6aeb,#d93461,#e5e5e5,#d4a838,#4cc290,#fb923c,#38bdf8",
  "a6-light": "#c94578,#5064d8,#8f5fc5,#242424,#e8a006,#1faa64,#ea580c,#1f8ad8",
  "a6-dark": "#d93461,#4f6aeb,#a855d1,#e5e5e5,#d4a838,#4cc290,#fb923c,#38bdf8",
  "mono-light": "#242424,#5064d8,#8f5fc5,#d63865,#e89e06,#1faa62,#ea580c,#1f8ad8",
  "mono-dark": "#e5e5e5,#4f6aeb,#a855d1,#d93461,#d4a838,#4cc290,#fb923c,#38bdf8"
};

// 素墨纪律：中性板不染色，影一律近黑（亮场把 A/B 的带色影换成中性黑影）
const MONO_SHADOWS: Record<"a" | "b", Record<"light" | "dark", Record<string, string>>> = {
  a: {
    light: {
      "shadow-sm": "0 1px 2px rgb(0 0 0 / 0.04), 0 4px 12px -4px rgb(0 0 0 / 0.05)",
      "shadow-md": "0 2px 4px rgb(0 0 0 / 0.07), 0 12px 32px rgb(0 0 0 / 0.08)",
      "shadow-lg": "0 2px 6px rgb(0 0 0 / 0.08), 0 16px 40px rgb(0 0 0 / 0.1)",
      "shadow-lift": "0 2px 4px -2px rgb(0 0 0 / 0.1), 0 12px 28px -14px rgb(0 0 0 / 0.16)",
      "shadow-overlay":
        "0 2px 4px -2px rgb(0 0 0 / 0.1), 0 12px 28px -14px rgb(0 0 0 / 0.16), inset 0 1px 0 rgb(255 255 255 / 0.86)",
      "shadow-dropdown":
        "0 2px 6px rgb(0 0 0 / 0.08), 0 16px 40px rgb(0 0 0 / 0.1), inset 0 1px 0 rgb(255 255 255 / 0.86)",
      "shadow-card":
        "0 2px 4px -2px rgb(0 0 0 / 0.1), 0 12px 28px -14px rgb(0 0 0 / 0.16), inset 0 1px 0 rgb(255 255 255 / 0.86)",
    },
    dark: {},
  },
  b: {
    light: {
      "shadow-sm": "0 1px 0 rgb(0 0 0 / 0.06)",
      "shadow-md": "0 1px 0 rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.08)",
      "shadow-lg": "0 2px 6px -2px rgb(0 0 0 / 0.1)",
      "shadow-lift": "0 1px 0 rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.08)",
      "shadow-overlay": "var(--frame), 0 2px 6px -2px rgb(0 0 0 / 0.1)",
      "shadow-dropdown": "var(--frame), 0 1px 0 rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.08)",
      "shadow-card": "var(--frame), 0 1px 0 rgb(0 0 0 / 0.06)",
    },
    dark: {},
  },
};

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function familyKeyOf(palette: string): string {
  return palette.replace(/-(light|dark)$/, "");
}

/** 把 ink 按百分比混进 base；0 则原样返回，避免无偏家族写出多余 color-mix。 */
function biasMix(base: string, ink: string, percent: number): string {
  if (percent <= 0) return base;
  return `color-mix(in srgb, ${base} ${100 - percent}%, ${ink})`;
}

/**
 * 纸色拉开（W4 G1）：不改 PALETTES 原相（与 RyuujiDesign lock 同源），
 * 按家族把 primary 混进纸/描边。藤色提高紫含量；樱花发丝沾春色；霜靛/素墨为 0。
 */
const PAPER_BIAS: Record<string, { paper: number; surface: number; border: number; hairline: number; subtle: number }> = {
  a1: { paper: 0, surface: 0, border: 0, hairline: 0, subtle: 0 },
  a3: { paper: 16, surface: 8, border: 22, hairline: 28, subtle: 16 },
  a6: { paper: 3, surface: 3, border: 12, hairline: 20, subtle: 0 },
  // 素墨 hairline 掺 12% 墨（亮）/纸（暗）：近无色系画布的卡片描边不靠投影也可见
  mono: { paper: 0, surface: 0, border: 0, hairline: 12, subtle: 0 },
};

function buildVariables(def: RyuujiThemeDef, p: RyuujiPalette): Record<string, string> {
  const light = def.scheme === "light";
  const isA = def.lang === "a";
  const isMono = def.palette.startsWith("mono-");
  const tags = TAGS[def.palette];
  const bias = PAPER_BIAS[familyKeyOf(def.palette)] ?? PAPER_BIAS.a1;
  const paperAmt = light ? bias.paper : Math.round(bias.paper * 0.75);
  const surfaceAmt = light ? bias.surface : Math.round(bias.surface * 0.8);
  const paper = biasMix(p.bg, p.primary, paperAmt);
  const paperTint = biasMix(p.bg_tint, p.primary, paperAmt);
  const paperSurface = biasMix(!light && !isA ? p.bg : p.surface, p.primary, surfaceAmt);
  const paperBorder = biasMix(p.border, p.primary, bias.border);
  // 星标色：B 暗色板的 signal 与 primary 不同时用 signal（仪表读数黄/橙），否则用 warning
  const favorite = !light && def.lang === "b" && p.signal !== p.primary ? p.signal : p.warning;

  return {
    // 结构令牌统一走造型语言层（themes/shapeLang.ts）
    ...shapeLangTokens(def.lang, def.scheme),
    // 素墨中性影覆盖（mono 板不染色）
    ...(isMono ? MONO_SHADOWS[def.lang][def.scheme] : {}),

    "bg-gradient": light
      ? `linear-gradient(180deg, ${paper} 0%, ${paperTint} 100%)`
      : `linear-gradient(180deg, ${paper} 0%, color-mix(in srgb, ${paper} 92%, #000000) 100%)`,
    "card-backdrop-filter": "none",
    "sidebar-backdrop-filter": "none",
    "welcome-accent-gradient": `linear-gradient(180deg, ${rgba(p.primary, light ? 0.1 : 0.12)}, transparent)`,
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
    "bg-elevated": light ? paperSurface : p.surface_2,
    "bg-overlay": light ? paperSurface : p.surface_2,
    // 行 hover：A = 近白实色罩（与实心选中行拉开层级）；B = primary 浅浅染实色
    "bg-hover": isA
      ? light
        ? `color-mix(in srgb, #ffffff 72%, ${paper})`
        : `color-mix(in srgb, #ffffff 8%, ${paperSurface})`
      : p.primary_soo_shallow,
    "bg-active": rgba(p.primary, light ? 0.13 : 0.16),
    "bg-card": !isA && !light ? `color-mix(in srgb, ${p.text} 5%, transparent)` : paperSurface,
    "bg-card-hover": light ? paperSurface : p.surface_2,
    // 输入底 = 分级表面：A 纸面 ctl 档；B 深槽（亮 text 5% / 暗 surface 94% 混黑）
    "bg-input": isA
      ? light
        ? `color-mix(in srgb, #ffffff 62%, ${paper})`
        : `color-mix(in srgb, ${paperSurface} 92%, ${paper})`
      : light
        ? `color-mix(in srgb, ${p.text} 5%, ${paperSurface})`
        : `color-mix(in srgb, ${paper} 94%, #000000)`,
    // 输入焦点三件套之底档：A focus 底换 ctl-hover（B 焦点只换 signal 描边，底不动）
    "bg-input-hover": isA
      ? light
        ? `color-mix(in srgb, #ffffff 72%, ${paper})`
        : paperSurface
      : light
        ? `color-mix(in srgb, ${p.text} 5%, ${paperSurface})`
        : `color-mix(in srgb, ${paper} 94%, #000000)`,

    "text-primary": p.text,
    "text-secondary": p.text_2,
    "text-tertiary": p.text_3,
    "text-muted": p.text_3,
    "text-faint": p.text_3,
    "text-ghost": light ? p.border : rgba(p.text_3, 0.3),
    "text-placeholder": p.text_3,
    "text-invert": p.on_primary,

    ...(isA ? {} : {
      "border-subtle": `color-mix(in srgb, ${p.text} ${light ? "12%" : "20%"}, transparent)`,
      "border-medium": p.border_strong,
    }),
    "border-default": paperBorder,
    "border-strong": rgba(p.text, light ? 0.55 : 0.5),
    ...(bias.subtle > 0
      ? {
          "border-subtle": `color-mix(in srgb, ${p.primary} ${light ? bias.subtle : bias.subtle + 8}%, transparent)`,
        }
      : {}),

    "accent-primary": p.primary,
    "accent-primary-hover": `color-mix(in srgb, ${p.primary} 96%, #000000)`,
    "accent-primary-bg": rgba(p.primary, light ? 0.09 : 0.16),
    "accent-primary-bg-light": rgba(p.primary, light ? 0.07 : 0.09),
    "accent-primary-ink": p.primary_ink,
    "accent-primary-shallow": p.primary_shallow,
    // 信号色：B 仪器焦点/当前项通道色（与 primary 可不同）；A 与 primary 同色
    "accent-signal": p.signal,

    // 选中行配方（lang 层契约）：A = 实心 primary + on-primary 白字 + 顶唇；
    // B = 15% 浅染 + 字重 600（菜单/命令面板/下拉一致；数据行与瓦片维持浅染）
    "row-selected-bg": isA ? p.primary : `color-mix(in srgb, ${p.primary} 15%, transparent)`,
    "row-selected-fg": isA ? p.on_primary : p.text,
    "row-selected-sub-fg": isA
      ? `color-mix(in srgb, ${p.on_primary} 90%, transparent)`
      : p.text_2,
    "row-selected-shadow": isA
      ? "inset 0 1px 0 rgb(255 255 255 / 0.22)"
      : "none",
    "row-selected-weight": isA ? "500" : "600",

    "color-danger": p.danger,
    "color-on-danger": "#ffffff",
    "color-danger-hover": `color-mix(in srgb, ${p.danger} 96%, #000000)`,
    "color-danger-bg": p.danger_so_shallow,
    "color-danger-ink": p.danger_ink,
    "color-warning": p.warning,
    "color-success": p.success,
    "color-favorite": favorite,
    // 键盘焦点环：A = primary（暗色换 primary-ink 提亮）；B 仪器焦点 = signal 通道色
    "color-focus-ring": isA ? (light ? p.primary : p.primary_ink) : p.signal,

    "overlay-bg": light ? `color-mix(in srgb, ${p.text} 72%, transparent)` : "rgba(0, 0, 0, 0.72)",
    "scrollbar-thumb": p.border_strong,
    "scrollbar-thumb-hover": p.text_2,

    "panel-titlebar-bg": light ? p.surface : isA ? p.surface : p.bg,
    "panel-body-bg": light ? p.surface : p.bg,

    // 壳层共享令牌（z 层级/拖拽/标签透明度/边框/面板规格）
    ...CHROME_TOKENS,
    // 素墨亮：chip alpha 加实一档，卡片胶囊与侧栏彩点保持同一色彩索引
    ...(isMono && light
      ? {
          "tag-color-alpha": "14%",
          "tag-selected-alpha": "20%",
          "tag-muted-alpha": "12%",
        }
      : {}),
  };
}

function buildTheme(def: RyuujiThemeDef): ThemeDefinition {
  const p = PALETTES[def.palette];
  const bias = PAPER_BIAS[familyKeyOf(def.palette)] ?? PAPER_BIAS.a1;
  // line-hairline 不是契约键：只在主题 css 里覆盖，避免扩 THEME_VARIABLE_KEYS
  const hairline = bias.hairline > 0
    ? `:root { --line-hairline: color-mix(in srgb, var(--accent-primary) ${bias.hairline}%, color-mix(in srgb, var(--border-default) 72%, transparent)); }`
    : "";
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
      ...(hairline ? [hairline] : []),
      ...(def.lang === "a" && def.scheme === "light" ? [".text-label { color: var(--text-faint); }"] : []),
    ].join("\n"),
  };
}

export const ryuujiThemes: ThemeDefinition[] = DEFS.map(buildTheme);

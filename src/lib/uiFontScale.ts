// ============================================================================
// lib/uiFontScale.ts — 界面字号（F03）
// ============================================================================
// 只缩放文字：写根节点 --ui-font-scale，index.css 的字号 token / Tailwind 字号工具类
// 与组件里的固定像素字号都乘以它。卡片尺寸、列表密度、间距不受影响（不是整体 DPI 缩放）。
// 档位有上下限；非法持久值回退标准档。
// ============================================================================

export const UI_FONT_SCALES = [
  { value: 0.9, label: "小" },
  { value: 1, label: "标准" },
  { value: 1.1, label: "大" },
  { value: 1.25, label: "特大" },
] as const;

export type UiFontScale = (typeof UI_FONT_SCALES)[number]["value"];

export const DEFAULT_UI_FONT_SCALE: UiFontScale = 1;

export function isUiFontScale(value: unknown): value is UiFontScale {
  return typeof value === "number" && UI_FONT_SCALES.some((s) => s.value === value);
}

export function applyUiFontScale(scale: UiFontScale, root: HTMLElement = document.documentElement): void {
  if (scale === DEFAULT_UI_FONT_SCALE) root.style.removeProperty("--ui-font-scale");
  else root.style.setProperty("--ui-font-scale", String(scale));
}

/** 虚拟列表行高估计：字号放大时行会被撑高，估计值随之放大以减少首帧跳动；真实高度仍由 measureElement 测量 */
export function scaledRowEstimate(baseHeight: number, scale: number): number {
  return Math.round(baseHeight * Math.max(1, scale));
}

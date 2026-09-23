// ============================================================================
// lib/cardSizeVars.ts — 卡片/大图标尺寸缩放
// ============================================================================
// 缩放值（1 = 默认）持久化在 workspace prefs，由 appStore 在初始化与变更时
// 调用 applyCardSizeVars 写成 document 根内联 CSS 变量：
//   --grid-col-min        卡片列最小宽度（列数 = 容器宽 / 该值）
//   --card-thumb-size     卡片缩略图边长
//   --grid-col-min-icons  大图标列最小宽度（封面 aspect-square 随之缩放）
// 缩放为 1 时移除内联覆盖，交还主题在样式表注册的同名变量。
// ItemGrid 订阅 store 中的缩放值并在变化时重算列数。
// ============================================================================

/** 卡片尺寸缩放范围（卡片列宽 192–384px） */
export const CARD_SIZE_SCALE_RANGE = { min: 0.75, max: 1.5 } as const;
/** 大图标尺寸缩放范围（图标列宽 118–294px） */
export const ICON_SIZE_SCALE_RANGE = { min: 0.7, max: 1.75 } as const;

export const BASE_CARD_COL_MIN = 256;
export const BASE_ICON_COL_MIN = 168;
const BASE_CARD_THUMB = 40;

/** 步进 0.05：滑杆 step=5% 与 +/- 按钮同口径 */
export const CARD_SIZE_SCALE_STEP = 0.05;

export function clampSizeScale(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(range.max, Math.max(range.min, value));
  // 步进取整后再按百分位去浮点尾数（0.05 步进的结果至多两位小数）
  return Math.round(Math.round(clamped / CARD_SIZE_SCALE_STEP) * CARD_SIZE_SCALE_STEP * 100) / 100;
}

export function applyCardSizeVars(cardScale: number, iconScale: number): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (cardScale === 1) root.style.removeProperty("--grid-col-min");
  else root.style.setProperty("--grid-col-min", `${Math.round(BASE_CARD_COL_MIN * cardScale)}px`);
  if (cardScale === 1) root.style.removeProperty("--card-thumb-size");
  else root.style.setProperty("--card-thumb-size", `${Math.round(BASE_CARD_THUMB * cardScale)}px`);
  // 标签文字缩放幅度收敛到 0.85–1.1：小尺寸档保住密度，大尺寸档不吹气球
  const textScale = Math.min(1.1, Math.max(0.85, cardScale));
  if (textScale === 1) root.style.removeProperty("--card-text-scale");
  else root.style.setProperty("--card-text-scale", String(textScale));
  // 小尺寸档标记供主题控制卡片密度。
  if (textScale < 0.95) root.setAttribute("data-card-small", "1");
  else root.removeAttribute("data-card-small");
  // 最小档（≤75%）标记：路径行整体隐藏，把空间与对比度预算让给完整标题
  if (cardScale <= CARD_SIZE_SCALE_RANGE.min + 1e-6) root.setAttribute("data-card-tiny", "1");
  else root.removeAttribute("data-card-tiny");
  if (iconScale === 1) root.style.removeProperty("--grid-col-min-icons");
  else root.style.setProperty("--grid-col-min-icons", `${Math.round(BASE_ICON_COL_MIN * iconScale)}px`);
}

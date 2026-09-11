export const FALLBACK_TAG_PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function getThemeTagPresetColors(): string[] {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--tag-preset-colors").trim();
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : FALLBACK_TAG_PRESET_COLORS;
}

/** 从当前主题调色板随机取一个标签颜色（getThemeTagPresetColors 保证非空，无需二次回退）。 */
export function pickRandomTagColor(): string {
  const palette = getThemeTagPresetColors();
  return palette[Math.floor(Math.random() * palette.length)] ?? FALLBACK_TAG_PRESET_COLORS[0];
}

/**
 * 按色相为色值推导中文色名。色板色值随主题变化（--tag-preset-colors），
 * 固定色名会与色值错位，故色名必须由色值本身推得。
 * 低饱和度（s<0.15）按明度命名（墨黑/铅灰/米白），其余按色相段命名；
 * 支持 #rgb/#rrggbb/#rrggbbaa，其余输入兜底「自定义」。
 */
export function nameColorByHue(hex: string): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex.trim());
  if (!match) return "自定义";
  let body = match[1];
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (s < 0.15) {
    if (l <= 0.25) return "墨黑";
    if (l >= 0.8) return "米白";
    return "铅灰";
  }

  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;

  if (h <= 15 || h > 345) return "蔷薇";
  if (h <= 40) return "蜜橙";
  if (h <= 70) return "琥珀";
  if (h <= 160) return "柳绿";
  if (h <= 200) return "青碧";
  if (h <= 255) return "晴蓝";
  if (h <= 290) return "藤紫";
  return "莓红";
}

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

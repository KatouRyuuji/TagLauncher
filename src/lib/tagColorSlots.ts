import { FALLBACK_TAG_PRESET_COLORS } from "./tagColors";

/** 官方家族标签/文件柜色位数量，对应当前主题 `--tag-preset-colors`。 */
export const TAG_COLOR_SLOT_COUNT = 8;

/** OKLCH chroma 低于此视为中性（素墨板、低饱和验收）。 */
const NEUTRAL_CHROMA = 0.04;

/** 色位记忆：hex 是记位时写入的颜色，用来判断用户是否手改过。 */
export interface ColorSlotRecord {
  slot: number;
  hex: string;
}

export interface ColorSlotMap {
  tags: Record<string, ColorSlotRecord>;
  cabinets: Record<string, ColorSlotRecord>;
  lastOfficialThemeId?: string;
}

export interface RecolorItem {
  id: number;
  color: string;
}

/** 逗号分隔 → 恰好 8 个 hex；不足循环补齐，多余截断；空串回退 Tailwind 演示板。 */
export function parsePalette(csv: string): string[] {
  const parts = csv
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const source = parts.length > 0 ? parts : FALLBACK_TAG_PRESET_COLORS;
  const out: string[] = [];
  for (let i = 0; i < TAG_COLOR_SLOT_COUNT; i++) {
    out.push(source[i % source.length] ?? FALLBACK_TAG_PRESET_COLORS[0]);
  }
  return out;
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  let body = match[1];
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  return [
    parseInt(body.slice(0, 2), 16) / 255,
    parseInt(body.slice(2, 4), 16) / 255,
    parseInt(body.slice(4, 6), 16) / 255,
  ];
}

/** sRGB 去 gamma → 线性。 */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

/**
 * sRGB hex → OKLab（Björn Ottosson 公开系数：线性 RGB → LMS → 立方根 → OKLab）。
 * 非法 hex 返回 null，调用方不得因此抛错。
 */
export function hexToOklab(hex: string): Oklab | null {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

/** OKLCH chroma = hypot(a, b)；与「L, C·cos H, C·sin H」笛卡尔距离同源。 */
export function oklchChroma(hex: string): number {
  const lab = hexToOklab(hex);
  if (!lab) return 0;
  return Math.hypot(lab.a, lab.b);
}

export function oklabDistance(hexA: string, hexB: string): number {
  const a = hexToOklab(hexA);
  const b = hexToOklab(hexB);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

export function hexEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isNeutralLab(lab: Oklab): boolean {
  return Math.hypot(lab.a, lab.b) < NEUTRAL_CHROMA;
}

/**
 * 在板上找最近色位。全中性板（素墨）只比 L，避免从灰阶反推色相；
 * 彩色板用 OKLab 欧氏距离（等价 OKLCH 笛卡尔）。
 */
export function nearestSlot(palette: string[], hex: string): number {
  if (palette.length === 0) return 0;
  const target = hexToOklab(hex);
  if (!target) return 0;

  const labs = palette.map((item) => hexToOklab(item));
  const known = labs.filter((lab): lab is Oklab => lab !== null);
  const allNeutral = known.length === palette.length && known.every(isNeutralLab);

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const lab = labs[i];
    if (!lab) continue;
    const distance = allNeutral
      ? Math.abs(lab.L - target.L)
      : Math.hypot(lab.L - target.L, lab.a - target.a, lab.b - target.b);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function isLiveRecord(record: ColorSlotRecord, currentHex: string): boolean {
  return (
    Number.isInteger(record.slot) &&
    record.slot >= 0 &&
    record.slot < TAG_COLOR_SLOT_COUNT &&
    hexEquals(record.hex, currentHex)
  );
}

/**
 * 有新鲜记录则用该位；否则在旧板找最近位。
 * previousPalette 为空时用新板（调用方应尽量传入旧官方板，避免首次进素墨按灰阶丢色相）。
 */
export function resolveSlot(
  record: ColorSlotRecord | undefined,
  currentHex: string,
  previousPalette: string[] | null,
  nextPalette: string[] = [],
): number {
  if (record && isLiveRecord(record, currentHex)) return record.slot;
  const palette =
    previousPalette && previousPalette.length > 0
      ? previousPalette
      : nextPalette.length > 0
        ? nextPalette
        : FALLBACK_TAG_PRESET_COLORS;
  return nearestSlot(palette, currentHex);
}

function planGroup(
  items: RecolorItem[],
  records: Record<string, ColorSlotRecord>,
  previousPalette: string[] | null,
  nextPalette: string[],
): { updates: RecolorItem[]; nextRecords: Record<string, ColorSlotRecord> } {
  const updates: RecolorItem[] = [];
  const nextRecords: Record<string, ColorSlotRecord> = {};
  for (const item of items) {
    const key = String(item.id);
    const slot = resolveSlot(records[key], item.color, previousPalette, nextPalette);
    const newHex = nextPalette[slot] ?? nextPalette[0] ?? FALLBACK_TAG_PRESET_COLORS[0];
    nextRecords[key] = { slot, hex: newHex };
    if (!hexEquals(newHex, item.color)) {
      updates.push({ id: item.id, color: newHex });
    }
  }
  return { updates, nextRecords };
}

/** 按色位规划写回：只把颜色会变的条目放进 updates，并重写全部色位记忆。 */
export function planRecolor(input: {
  tags: RecolorItem[];
  cabinets: RecolorItem[];
  slotMap: ColorSlotMap;
  previousPalette: string[] | null;
  nextPalette: string[];
}): { updates: { tags: RecolorItem[]; cabinets: RecolorItem[] }; nextSlotMap: ColorSlotMap } {
  const previousPalette =
    input.previousPalette && input.previousPalette.length > 0
      ? parsePalette(input.previousPalette.join(","))
      : null;
  const nextPalette = parsePalette(input.nextPalette.join(","));

  const tags = planGroup(input.tags, input.slotMap.tags, previousPalette, nextPalette);
  const cabinets = planGroup(input.cabinets, input.slotMap.cabinets, previousPalette, nextPalette);

  return {
    updates: { tags: tags.updates, cabinets: cabinets.updates },
    nextSlotMap: {
      tags: tags.nextRecords,
      cabinets: cabinets.nextRecords,
      lastOfficialThemeId: input.slotMap.lastOfficialThemeId,
    },
  };
}

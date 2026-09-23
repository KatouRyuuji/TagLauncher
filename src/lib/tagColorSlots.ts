import { FALLBACK_TAG_PRESET_COLORS } from "./tagColors";

/** 官方家族标签/文件柜色位数量，对应当前主题 `--tag-preset-colors`。 */
export const TAG_COLOR_SLOT_COUNT = 10;

/** 色位记忆设置键，与 useTagColorSlotSync / 手选色写回共用。 */
export const COLOR_SLOT_SETTING_KEY = "taglauncher.color_slots";

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

export function emptySlotMap(): ColorSlotMap {
  return { tags: {}, cabinets: {} };
}

export function parseSlotMap(raw: string | null): ColorSlotMap {
  if (!raw) return emptySlotMap();
  try {
    const parsed = JSON.parse(raw) as Partial<ColorSlotMap>;
    return {
      tags: parsed.tags && typeof parsed.tags === "object" ? parsed.tags : {},
      cabinets: parsed.cabinets && typeof parsed.cabinets === "object" ? parsed.cabinets : {},
      lastOfficialThemeId:
        typeof parsed.lastOfficialThemeId === "string" ? parsed.lastOfficialThemeId : undefined,
    };
  } catch {
    return emptySlotMap();
  }
}

/** 手选或打开编辑器时立刻吸附到当前主题色板。 */
export function snapToPalette(hex: string, palette: string[]): string {
  const board = palette.length > 0 ? palette : FALLBACK_TAG_PRESET_COLORS;
  return board[nearestSlot(board, hex)] ?? board[0] ?? FALLBACK_TAG_PRESET_COLORS[0];
}

export function recordPickedColor(
  slotMap: ColorSlotMap,
  kind: "tags" | "cabinets",
  id: number,
  hex: string,
  palette: string[],
): ColorSlotMap {
  const snapped = snapToPalette(hex, palette);
  const board = palette.length > 0 ? palette : FALLBACK_TAG_PRESET_COLORS;
  const slot = nearestSlot(board, snapped);
  return {
    ...slotMap,
    [kind]: {
      ...slotMap[kind],
      [String(id)]: { slot, hex: snapped },
    },
  };
}

/** 逗号分隔 → 恰好 10 个 hex；不足循环补齐，多余截断；空串回退 Tailwind 演示板。 */
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
 * 彩色标签优先保留色相，明度和饱和度作为次要差异，避免亮黄被吸附为橙色。
 */
export function nearestSlot(palette: string[], hex: string): number {
  if (palette.length === 0) return 0;
  const target = hexToOklab(hex);
  if (!target) return 0;

  const labs = palette.map((item) => hexToOklab(item));
  const known = labs.filter((lab): lab is Oklab => lab !== null);
  const allNeutral = known.length === palette.length && known.every(isNeutralLab);
  const targetChroma = Math.hypot(target.a, target.b);
  const targetHue = Math.atan2(target.b, target.a);

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const lab = labs[i];
    if (!lab) continue;
    const chroma = Math.hypot(lab.a, lab.b);
    const hueDelta = Math.abs(Math.atan2(lab.b, lab.a) - targetHue);
    const hueDistance = Math.min(hueDelta, 2 * Math.PI - hueDelta);
    const distance = allNeutral || targetChroma < NEUTRAL_CHROMA
      ? Math.hypot(lab.L - target.L, chroma * 3)
      : chroma < NEUTRAL_CHROMA
        ? 2
        : Math.hypot((lab.L - target.L) * 0.3, (chroma - targetChroma) * 0.3, hueDistance * 0.25);
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
  const colorStillOnBoard = !previousPalette?.length || previousPalette.some((hex) => hexEquals(hex, currentHex));
  if (record && isLiveRecord(record, currentHex) && colorStillOnBoard) return record.slot;
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
  const nextRecords: Record<string, ColorSlotRecord> = { ...records };
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

/** 按色位规划写回：只把颜色会变的条目放进 updates；nextSlotMap 从旧图出发只覆写本次出现的 id。 */
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

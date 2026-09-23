import * as db from "./db";
import { getThemeTagPresetColors } from "./tagColors";
import {
  COLOR_SLOT_SETTING_KEY,
  parseSlotMap,
  recordPickedColor,
  snapToPalette,
} from "./tagColorSlots";

/** 把标签/文件柜手选色吸附到当前主题 10 位，并立刻写入色位记忆。 */
export async function persistPickedThemeColor(
  kind: "tags" | "cabinets",
  id: number,
  hex: string,
): Promise<string> {
  const palette = getThemeTagPresetColors();
  const snapped = snapToPalette(hex, palette);
  const current = parseSlotMap(await db.getSetting(COLOR_SLOT_SETTING_KEY));
  const next = recordPickedColor(current, kind, id, snapped, palette);
  await db.setSetting(COLOR_SLOT_SETTING_KEY, JSON.stringify(next));
  return snapped;
}

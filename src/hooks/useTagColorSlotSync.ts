import { useEffect, useRef } from "react";
import { useThemeContext } from "../components/ThemeProvider";
import { FALLBACK_TAG_PRESET_COLORS } from "../lib/tagColors";
import {
  parsePalette,
  planRecolor,
  type ColorSlotMap,
} from "../lib/tagColorSlots";
import * as db from "../lib/db";
import { findFamilyByThemeId, getPresetTheme } from "../themes";
import { useAppStore } from "../stores/appStore";
import { notifyCabinetsChanged, notifyTagsChanged } from "../lib/modApi";
import { showToast } from "../lib/toast";
import { TAGS_WRITTEN_EVENT } from "./useTags";

const SLOT_SETTING_KEY = "taglauncher.color_slots";

function emptySlotMap(): ColorSlotMap {
  return { tags: {}, cabinets: {} };
}

function parseSlotMap(raw: string | null): ColorSlotMap {
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

function paletteOfTheme(themeId: string | undefined | null): string[] | null {
  if (!themeId) return null;
  const csv = getPresetTheme(themeId)?.variables["tag-preset-colors"];
  if (!csv) return null;
  return parsePalette(csv);
}

function resolvePreviousPalette(
  slotMap: ColorSlotMap,
  previousThemeId: string | null,
  themeId: string,
): string[] {
  const remembered = paletteOfTheme(slotMap.lastOfficialThemeId);
  if (remembered) return remembered;
  if (previousThemeId && previousThemeId !== themeId && findFamilyByThemeId(previousThemeId)) {
    const previous = paletteOfTheme(previousThemeId);
    if (previous) return previous;
  }
  return [...FALLBACK_TAG_PRESET_COLORS];
}

/**
 * 官方家族切换 / 首次进入时按色位写回标签/文件柜颜色。
 * store 里 tags 与 cabinets 都空时不规划、不 persist，等数据到齐再补跑。
 * 局部替换 store 的 color，并派发 TAGS_WRITTEN_EVENT 让对象卡片 pill 跟着换色。
 */
export function useTagColorSlotSync() {
  const { currentTheme } = useThemeContext();
  const themeId = currentTheme.id;
  const hasCatalog = useAppStore((state) => state.tags.length > 0 || state.cabinets.length > 0);
  const chainRef = useRef(Promise.resolve());
  const prevThemeIdRef = useRef<string | null>(null);
  const slotMapRef = useRef<ColorSlotMap>(emptySlotMap());
  const bootstrappedRef = useRef(false);
  const appliedThemeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!bootstrappedRef.current) {
        try {
          slotMapRef.current = parseSlotMap(await db.getSetting(SLOT_SETTING_KEY));
        } catch {
          slotMapRef.current = emptySlotMap();
        }
        bootstrappedRef.current = true;
      }

      const previousThemeId = prevThemeIdRef.current;
      prevThemeIdRef.current = themeId;

      if (!hasCatalog) return;
      if (!findFamilyByThemeId(themeId)) return;
      if (appliedThemeIdRef.current === themeId) return;

      const slotMap = slotMapRef.current;
      const previousPalette = resolvePreviousPalette(slotMap, previousThemeId, themeId);
      const nextPalette = paletteOfTheme(themeId) ?? [...FALLBACK_TAG_PRESET_COLORS];
      const { tags, cabinets } = useAppStore.getState();
      if (tags.length === 0 && cabinets.length === 0) return;

      const planned = planRecolor({
        tags: tags.map((tag) => ({ id: tag.id, color: tag.color })),
        cabinets: cabinets.map((cabinet) => ({ id: cabinet.id, color: cabinet.color })),
        slotMap,
        previousPalette,
        nextPalette,
      });
      planned.nextSlotMap.lastOfficialThemeId = themeId;

      if (planned.updates.tags.length > 0 || planned.updates.cabinets.length > 0) {
        await db.recolorTagsAndCabinets(planned.updates.tags, planned.updates.cabinets);
        const tagColor = new Map(planned.updates.tags.map((item) => [item.id, item.color]));
        const cabinetColor = new Map(planned.updates.cabinets.map((item) => [item.id, item.color]));
        const nextTags = useAppStore.getState().tags.map((tag) =>
          tagColor.has(tag.id) ? { ...tag, color: tagColor.get(tag.id)! } : tag,
        );
        const nextCabinets = useAppStore.getState().cabinets.map((cabinet) =>
          cabinetColor.has(cabinet.id) ? { ...cabinet, color: cabinetColor.get(cabinet.id)! } : cabinet,
        );
        useAppStore.getState().setTags(nextTags);
        useAppStore.getState().setCabinets(nextCabinets);
        notifyTagsChanged(nextTags);
        notifyCabinetsChanged(nextCabinets);
        window.dispatchEvent(new Event(TAGS_WRITTEN_EVENT));
      }

      await db.setSetting(SLOT_SETTING_KEY, JSON.stringify(planned.nextSlotMap));
      slotMapRef.current = planned.nextSlotMap;
      appliedThemeIdRef.current = themeId;
    };

    chainRef.current = chainRef.current
      .catch(() => undefined)
      .then(run)
      .catch((error) => {
        showToast(
          `切换主题时更新标签色失败：${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      });
  }, [themeId, hasCatalog]);
}

/** App 在 ThemeProvider 外，不能直接调 useThemeContext；作为 Provider 子节点挂载。 */
export function TagColorSlotSync() {
  useTagColorSlotSync();
  return null;
}

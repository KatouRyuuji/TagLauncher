import Fuse, { type FuseOptionKey, type FuseResult } from "fuse.js";
import { pinyin } from "pinyin-pro";
import type { ItemWithTags } from "../types";
import type { SearchMode } from "../stores/appStore";
import { expandQuery } from "./synonyms";

interface SearchableItem extends ItemWithTags {
  pinyinName: string;
  pinyinInitials: string;
  tagNames: string;
  tagPinyin: string;
  tagInitials: string;
}

export interface SearchIndex {
  items: ItemWithTags[];
  fuse: Fuse<SearchableItem> | null;
}

function enrichItem(item: ItemWithTags): SearchableItem {
  const pinyinName = pinyin(item.name, { toneType: "none", type: "array" }).join("");
  const pinyinInitials = pinyin(item.name, { pattern: "first", toneType: "none", type: "array" }).join("");
  const tagNames = item.tags.map((t) => t.name).join(" ");
  const tagPinyin = item.tags
    .map((t) => pinyin(t.name, { toneType: "none", type: "array" }).join(""))
    .join(" ");
  const tagInitials = item.tags
    .map((t) => pinyin(t.name, { pattern: "first", toneType: "none", type: "array" }).join(""))
    .join(" ");
  return { ...item, pinyinName, pinyinInitials, tagNames, tagPinyin, tagInitials };
}

const NAME_KEYS: FuseOptionKey<SearchableItem>[] = [
  { name: "name", weight: 3 },
  { name: "pinyinName", weight: 2 },
  { name: "pinyinInitials", weight: 1.5 },
  { name: "path", weight: 0.5 },
];

const TAG_KEYS: FuseOptionKey<SearchableItem>[] = [
  { name: "tagNames", weight: 3 },
  { name: "tagPinyin", weight: 2 },
  { name: "tagInitials", weight: 1.5 },
];

const ALL_KEYS: FuseOptionKey<SearchableItem>[] = [...NAME_KEYS, ...TAG_KEYS];

function getKeys(mode: SearchMode): FuseOptionKey<SearchableItem>[] {
  if (mode === "name") return NAME_KEYS;
  if (mode === "tag") return TAG_KEYS;
  return ALL_KEYS;
}

export function filterItemsByTags(items: ItemWithTags[], selectedTagIds: number[]): ItemWithTags[] {
  if (selectedTagIds.length === 0) return items;
  return items.filter((item) =>
    selectedTagIds.every((tid) => item.tags.some((t) => t.id === tid)),
  );
}

export function buildSearchIndex(items: ItemWithTags[], mode: SearchMode): SearchIndex {
  if (items.length === 0) {
    return { items, fuse: null };
  }

  const enriched = items.map(enrichItem);
  const fuse = new Fuse(enriched, {
    keys: getKeys(mode),
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });

  return { items, fuse };
}

export function searchWithIndex(index: SearchIndex, query: string): ItemWithTags[] {
  const normalized = query.trim();
  if (!normalized) return index.items;
  if (!index.fuse) return [];

  const queries = expandQuery(query);
  const bestScoreMap = new Map<number, FuseResult<SearchableItem>>();

  for (const q of queries) {
    const subQuery = q.trim();
    if (!subQuery) continue;

    for (const r of index.fuse.search(subQuery)) {
      const id = r.item.id;
      const existing = bestScoreMap.get(id);
      if (!existing || (r.score ?? 1) < (existing.score ?? 1)) {
        bestScoreMap.set(id, r);
      }
    }
  }

  return Array.from(bestScoreMap.values())
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .map((r) => {
      const { pinyinName, pinyinInitials, tagNames, tagPinyin, tagInitials, ...original } = r.item;
      return original as ItemWithTags;
    })
    .sort((a, b) => {
      if (a.is_favorite && !b.is_favorite) return -1;
      if (!a.is_favorite && b.is_favorite) return 1;
      return 0;
    });
}

export function fuzzySearch(
  items: ItemWithTags[],
  query: string,
  mode: SearchMode,
  selectedTagIds: number[],
): ItemWithTags[] {
  const filtered = filterItemsByTags(items, selectedTagIds);
  const index = buildSearchIndex(filtered, mode);
  return searchWithIndex(index, query);
}
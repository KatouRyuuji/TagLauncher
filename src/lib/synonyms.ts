import { invoke } from "@tauri-apps/api/core";

let synonymMap = new Map<string, string[]>();

export async function loadSynonyms(): Promise<void> {
  try {
    const groups = await invoke<string[][]>("read_synonyms");
    const map = new Map<string, string[]>();

    for (const group of groups) {
      const normalizedGroup = group
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0);
      if (normalizedGroup.length === 0) continue;

      for (const word of normalizedGroup) {
        map.set(word, normalizedGroup);
      }
    }

    synonymMap = map;
  } catch (error) {
    console.error("Failed to load synonyms:", error);
    synonymMap = new Map();
  }
}

export function expandQuery(query: string): string[] {
  const key = query.trim().toLowerCase();
  if (!key) return [query];

  const group = synonymMap.get(key);
  if (!group) return [query];

  return [query, ...group.filter((w) => w !== key)];
}
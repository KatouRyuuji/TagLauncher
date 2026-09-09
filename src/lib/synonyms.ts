import { readSynonyms } from "./db";

let synonymMap = new Map<string, string[]>();

function buildSynonymMap(groups: string[][]): Map<string, string[]> {
  // 同义词关系是等价类：组与组之间只要有共享词就并成一组，
  // 否则 [游戏,game] 与 [game,电竞] 并存时传递链断裂、三者不互通。
  const merged: string[][] = [];
  const wordToGroupIdx = new Map<string, number>();

  for (const group of groups) {
    const normalizedGroup = group
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0);
    if (normalizedGroup.length === 0) continue;

    // 收集与当前组共享词的已有组
    const hitIdxs = new Set<number>();
    for (const word of normalizedGroup) {
      const idx = wordToGroupIdx.get(word);
      if (idx !== undefined) hitIdxs.add(idx);
    }

    if (hitIdxs.size === 0) {
      const unique = [...new Set(normalizedGroup)];
      const idx = merged.length;
      merged.push(unique);
      for (const word of unique) wordToGroupIdx.set(word, idx);
      continue;
    }

    // 并入第一个命中组，其余命中组整体迁移进来，保持成员首次出现顺序
    const [target, ...rest] = [...hitIdxs];
    const targetGroup = merged[target];
    const members = new Set(targetGroup);
    const append = (word: string) => {
      if (members.has(word)) return;
      members.add(word);
      targetGroup.push(word);
    };
    for (const word of normalizedGroup) append(word);
    for (const idx of rest) {
      for (const word of merged[idx]) append(word);
      merged[idx] = [];
    }
    for (const word of targetGroup) wordToGroupIdx.set(word, target);
  }

  const map = new Map<string, string[]>();
  for (const group of merged) {
    if (group.length === 0) continue;
    for (const word of group) map.set(word, group);
  }
  return map;
}

export async function loadSynonyms(): Promise<void> {
  try {
    const groups = await readSynonyms();
    synonymMap = buildSynonymMap(groups);
  } catch (error) {
    console.error("Failed to load synonyms:", error);
    synonymMap = new Map();
  }
}

export function setSynonymGroups(groups: string[][]): void {
  synonymMap = buildSynonymMap(groups);
}

export function expandQuery(query: string): string[] {
  const key = query.trim().toLowerCase();
  if (!key) return [query];

  const group = synonymMap.get(key);
  if (!group) return [query];

  return [query, ...group.filter((w) => w !== key)];
}

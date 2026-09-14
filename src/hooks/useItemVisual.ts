import { useEffect, useState } from "react";
import type { Item } from "../types";
import { immediateItemVisual, itemVisualKey, subscribeItemVisual } from "../lib/itemVisualCache";

export function useItemVisual(item: Item): string | null {
  const key = itemVisualKey(item);
  const [resolved, setResolved] = useState<{ key: string; path: string | null } | null>(null);
  useEffect(() => subscribeItemVisual(item, (path) => setResolved({ key, path })), [item, key]);
  const immediate = immediateItemVisual(item);
  return immediate !== undefined ? immediate : resolved?.key === key ? resolved.path : null;
}

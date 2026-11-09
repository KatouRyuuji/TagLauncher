import type { ItemWithTags } from "../types";

/**
 * 从排队的新对象中挑出需要自动打标的目标：去重、跳过已有标签的对象。
 * 优先使用最新快照中的数据（可能已被用户打上标签）；快照尚未包含该对象时
 * （items-added 事件早于 allItems 快照 effect 同步，BUG-17）回退到排队时的对象本身。
 */
export function selectAutoTagTargets(queued: ItemWithTags[], snapshot: ItemWithTags[]): ItemWithTags[] {
  const freshById = new Map(snapshot.map((item) => [item.id, item]));
  const seen = new Set<number>();
  return queued
    .map((queuedItem) => freshById.get(queuedItem.id) ?? queuedItem)
    .filter((item) => item.tags.length === 0)
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

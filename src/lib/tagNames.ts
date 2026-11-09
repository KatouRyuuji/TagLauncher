import type { Tag } from "../types";

/** 按名称大小写不敏感查找标签（首尾空白忽略）；侧栏新建标签复用既有标签用（BUG-15） */
export function findTagByNameInsensitive<T extends Pick<Tag, "name">>(tags: readonly T[], name: string): T | undefined {
  const key = name.trim().toLowerCase();
  return tags.find((t) => t.name.trim().toLowerCase() === key);
}

// ============================================================================
// quick/quickModel.ts — 快速搜索窗的纯逻辑（结果、按键映射、标签切换）
// ============================================================================
// 结果来自后端 quick_search（与主窗 view_query 同一个 Rust 内存索引），只取前 50 条；
// 类型「全部」、无标签/柜筛选，隐藏丢失对象的偏好与主窗共用 workspace_prefs。
// ============================================================================

import type { ItemWithTags } from "../types";

export const QUICK_RESULT_LIMIT = 50;

export type QuickAction = "up" | "down" | "launch" | "reveal" | "copy" | "locate" | "tag" | "escape";

/** 结果列表上的按键 → 动作（输入框焦点下生效；文本编辑键不拦截） */
export function quickKeyAction(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): QuickAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "Escape":
      return "escape";
    case "Enter":
      if (e.altKey) return "locate";
      if (ctrl) return "reveal";
      return "launch";
    default:
      break;
  }
  if (ctrl && !e.altKey && (e.key === "t" || e.key === "T") && !e.shiftKey) return "tag";
  if (ctrl && e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) return "copy";
  return null;
}

/** 循环移动选中行 */
export function stepIndex(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** 切换对象上的某个标签，返回新的标签 ID 列表（保持原顺序，新标签追加在末尾） */
export function toggledTagIds(item: Pick<ItemWithTags, "tags">, tagId: number): number[] {
  const ids = item.tags.map((tag) => tag.id);
  return ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId];
}

/** 标签选择器的过滤：名称包含（不分大小写），已在对象上的排前面 */
export function filterTagChoices<T extends { id: number; name: string }>(
  tags: T[],
  query: string,
  activeIds: ReadonlySet<number>,
): T[] {
  const q = query.trim().toLowerCase();
  const matched = q ? tags.filter((tag) => tag.name.toLowerCase().includes(q)) : tags;
  return [...matched.filter((t) => activeIds.has(t.id)), ...matched.filter((t) => !activeIds.has(t.id))];
}

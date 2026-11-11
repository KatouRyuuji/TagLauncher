// ============================================================================
// quick/pinModel.ts — 钉住视图的纯逻辑（筛选、抽屉计时常量），便于单测
// ============================================================================

import type { ItemWithTags } from "../types";
import { itemDisplayName } from "../lib/itemDisplay";

/** 鼠标在把手上停留这么久才滑出（避免划过屏幕边误触） */
export const PIN_HOVER_EXPAND_MS = 120;
/** 鼠标离开面板这么久后收回 */
export const PIN_LEAVE_COLLAPSE_MS = 400;
/** 只给前 N 条取图标（同快速窗口径） */
export const PIN_ICON_LIMIT = 20;

/** 名称 / 别名 / 路径 / 标签名的不分大小写子串匹配；空词返回原列表 */
export function filterPinItems(items: ItemWithTags[], filter: string): ItemWithTags[] {
  const q = filter.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    itemDisplayName(item).toLowerCase().includes(q) ||
    item.name.toLowerCase().includes(q) ||
    item.path.toLowerCase().includes(q) ||
    item.tags.some((t) => t.name.toLowerCase().includes(q)),
  );
}

/** 页脚文字：全部列出 / 只列前 N 项 */
export function pinCountText(total: number, shown: number, filtered: number, filter: string): string {
  if (filter.trim()) return `匹配 ${filtered} 项`;
  if (total > shown) return `共 ${total} 项，显示前 ${shown} 项（其余请在主窗口查看）`;
  return `共 ${total} 项`;
}

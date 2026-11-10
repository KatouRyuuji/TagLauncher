// ============================================================================
// lib/itemDisplay.ts — 显示别名（F07）
// ============================================================================
// 别名只影响界面显示与搜索：磁盘文件名仍是 item.name，F2 重命名、导出、复制路径都用
// name/path。单一入口，避免各组件各自判断出现两套口径。
// ============================================================================

import type { Item } from "../types";

/** 别名上限（按字符计），与后端 ALIAS_MAX_CHARS 一致。 */
export const ALIAS_MAX_CHARS = 120;

type AliasSource = Pick<Item, "name" | "alias">;

/** 有效别名：去首尾空白后非空才算 */
export function itemAlias(item: AliasSource): string | null {
  const alias = item.alias?.trim();
  return alias ? alias : null;
}

/** 界面主显示名：有别名用别名，否则用磁盘名 */
export function itemDisplayName(item: AliasSource): string {
  return itemAlias(item) ?? item.name;
}

/** 悬浮提示：有别名时同时给出磁盘名，防止用户把别名当成真实文件名 */
export function itemNameTitle(item: AliasSource): string {
  const alias = itemAlias(item);
  return alias ? `${alias}（磁盘名：${item.name}）` : item.name;
}

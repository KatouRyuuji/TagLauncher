// ============================================================================
// lib/searchPipeline.ts — 搜索结果管线（主窗与快速搜索窗共用）
// ============================================================================
// 主窗 useItems 与快速搜索窗必须得到同一组、同一顺序的结果：两边都只调这里，
// 不各自拼 searchWithIndex + 类型/缺失过滤（快速窗等价于主窗「全部类型、无标签/柜筛选」）。
// ============================================================================

import { searchWithIndex, type SearchIndex } from "./search";
import { applyMissingFilter, applyTypeFilter, type TypeFilter } from "./itemQuery";
import type { ItemWithTags } from "../types";

export function runSearchPipeline(
  index: SearchIndex,
  query: string,
  opts: { typeFilter: TypeFilter; hideMissing: boolean },
): ItemWithTags[] {
  return applyMissingFilter(applyTypeFilter(searchWithIndex(index, query), opts.typeFilter), opts.hideMissing);
}

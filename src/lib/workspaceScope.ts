// ============================================================================
// lib/workspaceScope.ts — 工作台当前范围标题（纯函数，无 React）
// ============================================================================
// 主区顶部「现在在看什么」：收藏 / 最近 / 柜 / 标签互斥，与 appStore 一致。
// 数量与限定语（含下级、类型、搜索词）写在内容区，而不是只靠底栏小字。
// ============================================================================

import type { TagRelation } from "../types";
import { truncateQueryForDisplay } from "./emptyStateCopy";
import { typeFilterLabel, type TypeFilter } from "./itemQuery";
import { buildChildrenMap } from "./tagGraph";

export interface WorkspaceScopeInput {
  showFavorites: boolean;
  showRecent: boolean;
  selectedCabinetId: number | null;
  cabinets: { id: number; name: string }[];
  selectedTagIds: number[];
  excludedTagIds: number[];
  tags: { id: number; name: string }[];
  /** 用 buildChildrenMap 判断某标签是否有下级 */
  tagRelations: TagRelation[];
  typeFilter: TypeFilter;
  searchQuery: string;
  visibleCount: number;
}

export interface WorkspaceScope {
  title: string;
  qualifiers: string[];
  count: number;
}

function nameOf(list: { id: number; name: string }[], id: number): string | undefined {
  return list.find((entry) => entry.id === id)?.name;
}

/** 正选名用「 且 」连接；排除写成「且非 X」。无名 id 跳过。 */
function resolveTagTitle(input: WorkspaceScopeInput): string | null {
  const includeNames = input.selectedTagIds
    .map((id) => nameOf(input.tags, id))
    .filter((name): name is string => Boolean(name));
  const excludeClauses = input.excludedTagIds
    .map((id) => nameOf(input.tags, id))
    .filter((name): name is string => Boolean(name))
    .map((name) => `且非 ${name}`);

  if (includeNames.length === 0 && excludeClauses.length === 0) return null;
  if (includeNames.length === 0) return excludeClauses.join(" ");
  const includeTitle = includeNames.join(" 且 ");
  return excludeClauses.length > 0 ? `${includeTitle} ${excludeClauses.join(" ")}` : includeTitle;
}

function resolveTitle(input: WorkspaceScopeInput): string {
  if (input.showFavorites) return "收藏夹";
  if (input.showRecent) return "最近使用";
  if (input.selectedCabinetId !== null) {
    return nameOf(input.cabinets, input.selectedCabinetId) ?? "文件柜";
  }
  return resolveTagTitle(input) ?? "全部项目";
}

export function resolveWorkspaceScope(input: WorkspaceScopeInput): WorkspaceScope {
  const qualifiers: string[] = [];

  if (input.selectedTagIds.length === 1) {
    const children = buildChildrenMap(input.tagRelations).get(input.selectedTagIds[0]);
    if (children && children.length > 0) qualifiers.push("含下级");
  }
  if (input.typeFilter !== "all") {
    qualifiers.push(typeFilterLabel(input.typeFilter));
  }
  if (input.searchQuery.trim() !== "") {
    qualifiers.push(`“${truncateQueryForDisplay(input.searchQuery)}”`);
  }

  return {
    title: resolveTitle(input),
    qualifiers,
    count: input.visibleCount,
  };
}

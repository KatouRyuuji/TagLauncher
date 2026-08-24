// ============================================================================
// lib/emptyStateCopy.ts — 工作台空态文案（纯逻辑，供 WorkspaceEmptyState 使用）
// ============================================================================
// 三种空态语义不同，混为一谈会误导用户：
//   library — 库里一个对象都没有：引导导入，清筛选没有意义；
//   search  — 搜索词无命中：优先引导改词/清空搜索，其次才是清全部筛选；
//   filter  — 标签/类型/范围筛选无命中（无搜索词）：引导清空筛选。
// ============================================================================

export type EmptyStateVariant = "library" | "search" | "filter";

/** 根据「库是否为空」与「是否有生效中的搜索词」解析空态语义。 */
export function resolveEmptyStateVariant(
  kind: "library" | "filter",
  searchQuery: string,
): EmptyStateVariant {
  if (kind === "library") return "library";
  return searchQuery.trim() !== "" ? "search" : "filter";
}

export interface EmptyStateCopy {
  title: string;
  description: string;
  /** 是否显示「清空搜索」按钮（仅搜索无命中时） */
  showClearSearch: boolean;
  /** 是否显示「清空所有筛选」按钮（筛选/搜索无命中时） */
  showClearFilters: boolean;
}

const MAX_QUERY_DISPLAY = 24;

/** 标题里展示的搜索词做截断，避免超长词把空态面板撑破。 */
export function truncateQueryForDisplay(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= MAX_QUERY_DISPLAY) return trimmed;
  return `${trimmed.slice(0, MAX_QUERY_DISPLAY)}…`;
}

export function emptyStateCopy(variant: EmptyStateVariant, searchQuery: string): EmptyStateCopy {
  switch (variant) {
    case "library":
      return {
        title: "暂无项目",
        description: "将文件或文件夹拖拽到主区域，或使用顶部按钮开始导入。",
        showClearSearch: false,
        showClearFilters: false,
      };
    case "search":
      return {
        title: `没有找到“${truncateQueryForDisplay(searchQuery)}”`,
        description: "试试换个关键词、切换搜索范围（全部 / 名称 / 标签），或清空搜索。",
        showClearSearch: true,
        showClearFilters: true,
      };
    case "filter":
      return {
        title: "没有匹配的项目",
        description: "当前标签、类型或范围筛选下没有命中，试试清空筛选或按 / 重新搜索。",
        showClearSearch: false,
        showClearFilters: true,
      };
  }
}

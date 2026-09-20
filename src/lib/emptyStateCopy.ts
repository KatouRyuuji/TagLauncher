// ============================================================================
// lib/emptyStateCopy.ts — 工作台空态文案（纯逻辑，供 WorkspaceEmptyState 使用）
// ============================================================================
// 空态语义不同，混为一谈会误导用户：
//   library   — 库里一个项目都没有：引导导入；若仍有标签/文件柜，补一句承认它们还在。
//   search    — 搜索词无命中；
//   filter    — 标签/类型筛选无命中；
//   cabinet   — 当前文件柜没有项目；
//   favorites — 收藏夹为空；
//   recent    — 还没有打开过项目。
// ============================================================================

export type EmptyStateVariant = "library" | "search" | "filter" | "cabinet" | "favorites" | "recent";

export interface EmptyStateScope {
  cabinet?: boolean;
  favorites?: boolean;
  recent?: boolean;
}

/** 根据「库是否为空」、搜索词与当前范围解析空态语义。 */
export function resolveEmptyStateVariant(
  kind: "library" | "filter",
  searchQuery: string,
  scope: EmptyStateScope = {},
): EmptyStateVariant {
  if (kind === "library") return "library";
  if (searchQuery.trim() !== "") return "search";
  if (scope.favorites) return "favorites";
  if (scope.recent) return "recent";
  if (scope.cabinet) return "cabinet";
  return "filter";
}

export interface EmptyStateCopy {
  title: string;
  description: string;
  /** 是否显示「清空搜索」按钮（仅搜索无命中时） */
  showClearSearch: boolean;
  /** 是否显示「清空所有筛选」按钮（筛选/搜索/柜/收藏/最近无命中时） */
  showClearFilters: boolean;
}

const MAX_QUERY_DISPLAY = 24;

/** 标题里展示的搜索词做截断，避免超长词把空态面板撑破。 */
export function truncateQueryForDisplay(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= MAX_QUERY_DISPLAY) return trimmed;
  return `${trimmed.slice(0, MAX_QUERY_DISPLAY)}…`;
}

export interface EmptyStateCopyContext {
  hasTags?: boolean;
  hasCabinets?: boolean;
}

function libraryRemainingHint(context?: EmptyStateCopyContext): string {
  const hasTags = Boolean(context?.hasTags);
  const hasCabinets = Boolean(context?.hasCabinets);
  if (hasTags && hasCabinets) return "项目不在了，标签和文件柜还在，可以继续用。";
  if (hasTags) return "项目不在了，标签还在，可以继续用。";
  if (hasCabinets) return "项目不在了，文件柜还在，可以继续用。";
  return "";
}

export function emptyStateCopy(
  variant: EmptyStateVariant,
  searchQuery: string,
  context?: EmptyStateCopyContext,
): EmptyStateCopy {
  switch (variant) {
    case "library": {
      const libraryLead = "将文件或文件夹拖到主区域，或点下方按钮加入库。文件柜只是分组，不会移动磁盘上的文件。";
      const remainingHint = libraryRemainingHint(context);
      return {
        title: "暂无项目",
        description: remainingHint ? `${libraryLead}${remainingHint}` : libraryLead,
        showClearSearch: false,
        showClearFilters: false,
      };
    }
    case "search":
      return {
        title: `没有找到“${truncateQueryForDisplay(searchQuery)}”`,
        description: "试试换个关键词、切换搜索范围（全部 / 名称 / 标签），或清空搜索。也可以用表达式组合标签：如「开发&&自动化」同时满足、「游戏!!卡牌」排除。",
        showClearSearch: true,
        showClearFilters: true,
      };
    case "cabinet":
      return {
        title: "这个文件柜还是空的",
        description: "文件柜是标签式分组，不会移动磁盘上的文件。把项目拖进来，或退出当前文件柜查看全部项目。",
        showClearSearch: false,
        showClearFilters: true,
      };
    case "favorites":
      return {
        title: "收藏夹是空的",
        description: "给常用项目点星标，它们会出现在这里。",
        showClearSearch: false,
        showClearFilters: true,
      };
    case "recent":
      return {
        title: "还没有最近使用",
        description: "打开过的项目会出现在这里。",
        showClearSearch: false,
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

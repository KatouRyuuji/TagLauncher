// ============================================================================
// components/WorkspaceScopeHeader.tsx — 主区顶部「当前范围」标题
// ============================================================================
// 空库由 App 用 allItems.length > 0 守卫（等同 libraryEmpty）；筛选后 0 项仍渲染，
// 空态面板在下方。状态从 store 派生，不写回。
// ============================================================================

import { useMemo } from "react";
import { resolveWorkspaceScope } from "../lib/workspaceScope";
import { useAppStore } from "../stores/appStore";

export function WorkspaceScopeHeader({ visibleCount, pending = false }: { visibleCount: number; pending?: boolean }) {
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const cabinets = useAppStore((state) => state.cabinets);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const tags = useAppStore((state) => state.tags);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const typeFilter = useAppStore((state) => state.typeFilter);
  // 直订阅 searchQuery：经 useSearch 会连坐 searchInputValue，每击键白跑一次 resolve
  const searchQuery = useAppStore((state) => state.searchQuery);

  const scope = useMemo(
    () =>
      resolveWorkspaceScope({
        showFavorites,
        showRecent,
        selectedCabinetId,
        cabinets,
        selectedTagIds,
        excludedTagIds,
        tags,
        tagRelations,
        typeFilter,
        searchQuery,
        visibleCount,
      }),
    [
      showFavorites,
      showRecent,
      selectedCabinetId,
      cabinets,
      selectedTagIds,
      excludedTagIds,
      tags,
      tagRelations,
      typeFilter,
      searchQuery,
      visibleCount,
    ],
  );

  return (
    <div data-region="scope-header" className="flex shrink-0 items-baseline gap-3 px-6 pt-5 pb-2">
      <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{scope.title}</h2>
      <span className="text-[12px] tabular-nums text-[var(--text-muted)]">{pending ? "正在打开文件柜" : `${scope.count} 项`}</span>
      {scope.qualifiers.length > 0 && (
        <span className="text-[13px] text-[var(--text-muted)]">{scope.qualifiers.join(" · ")}</span>
      )}
    </div>
  );
}

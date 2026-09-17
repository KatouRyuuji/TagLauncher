// ============================================================================
// components/WorkspaceScopeHeader.tsx — 主区顶部「当前范围」标题
// ============================================================================
// 空库由 App 用 allItems.length > 0 守卫（等同 libraryEmpty）；筛选后 0 项仍渲染，
// 空态面板在下方。状态从 store 派生，不写回。
// ============================================================================

import { useMemo } from "react";
import { useSearch } from "../hooks/useSearch";
import { resolveWorkspaceScope } from "../lib/workspaceScope";
import { useAppStore } from "../stores/appStore";

export function WorkspaceScopeHeader({ visibleCount }: { visibleCount: number }) {
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const cabinets = useAppStore((state) => state.cabinets);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const tags = useAppStore((state) => state.tags);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const { searchQuery } = useSearch();

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
    <div data-region="scope-header" className="flex shrink-0 items-baseline gap-2 px-6 pt-4 pb-1">
      <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{scope.title}</h2>
      <span className="data-readout text-[var(--text-muted)]">{scope.count} 项</span>
      {scope.qualifiers.length > 0 && (
        <span className="text-[13px] text-[var(--text-muted)]">{scope.qualifiers.join(" · ")}</span>
      )}
    </div>
  );
}

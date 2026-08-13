import { useAppStore } from "../stores/appStore";
import { sortModeLabel, typeFilterLabel } from "../lib/itemQuery";

export function StatusBar({
  visibleCount,
  selectedCount,
  libraryCount,
}: {
  visibleCount: number;
  selectedCount: number;
  libraryCount: number;
}) {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const sortMode = useAppStore((state) => state.sortMode);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);

  const scope = showFavorites
    ? "收藏夹"
    : showRecent
      ? "最近使用"
      : selectedCabinetId !== null
        ? "文件柜"
        : selectedTagIds.length > 0
          ? `${selectedTagIds.length} 个标签`
          : "全部";

  const parts = [`${visibleCount} 项`, scope];
  if (selectedCount > 0) parts.push(`已选 ${selectedCount}`);
  if (typeFilter !== "all") parts.push(typeFilterLabel(typeFilter));
  if (searchQuery.trim()) parts.push(`“${searchQuery.trim()}”`);
  if (visibleCount !== libraryCount && !showFavorites && !showRecent && selectedCabinetId === null) {
    parts.push(`库内 ${libraryCount}`);
  }

  return (
    <footer
      data-region="statusbar"
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_78%,transparent)] px-5 text-[11px] text-[var(--text-faint)]"
    >
      <span className="min-w-0 truncate">{parts.join(" · ")}</span>
      <span className="shrink-0">排序 {sortModeLabel(sortMode)} · Ctrl+K 命令</span>
    </footer>
  );
}

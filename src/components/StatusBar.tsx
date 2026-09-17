import { useEffect, useState } from "react";
import { ArrowUpDown, Command, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { useSearch } from "../hooks/useSearch";
import { sortModeLabel, typeFilterLabel } from "../lib/itemQuery";
import { showToast } from "../lib/toast";
import type { ItemWithTags } from "../types";
import { MissingItemsReviewDialog } from "./MissingItemsReviewDialog";

export function StatusBar({
  visibleCount,
  selectedCount,
  libraryCount,
  missingItems,
  onRelocateMissing,
  onRemoveMissing,
}: {
  visibleCount: number;
  selectedCount: number;
  libraryCount: number;
  missingItems: ItemWithTags[];
  onRelocateMissing: () => Promise<number>;
  onRemoveMissing: (ids: number[]) => Promise<void>;
}) {
  const { searchQuery, inputValue } = useSearch();
  const sortMode = useAppStore((state) => state.sortMode);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const reviewOpen = useAppStore((state) => state.missingReviewOpen);
  const setReviewOpen = useAppStore((state) => state.setMissingReviewOpen);
  const [relocating, setRelocating] = useState(false);
  const missingCount = missingItems.length;

  useEffect(() => {
    if (reviewOpen && missingCount === 0) {
      setReviewOpen(false);
    }
  }, [missingCount, reviewOpen, setReviewOpen]);

  const handleRelocate = async () => {
    if (relocating) return;
    setRelocating(true);
    try {
      const recovered = await onRelocateMissing();
      if (recovered === 0) {
        showToast("未能自动找回失效项目：请确认磁盘已连接；文件恢复后会自动重新关联", "error");
      }
    } catch (err) {
      showToast(`找回失效项目失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setRelocating(false);
    }
  };

  const tagScope = [
    selectedTagIds.length > 0 ? `${selectedTagIds.length} 个标签` : null,
    excludedTagIds.length > 0 ? `排除 ${excludedTagIds.length} 个标签` : null,
  ].filter(Boolean).join(" · ");

  const scope = showFavorites
    ? "收藏夹"
    : showRecent
      ? "最近使用"
      : selectedCabinetId !== null
        ? "文件柜"
        : tagScope || "全部";

  const searchPending = inputValue !== searchQuery;

  const parts = [`${visibleCount} 项目`, scope];
  if (selectedCount > 0) parts.push(`已选 ${selectedCount}`);
  if (typeFilter !== "all") parts.push(typeFilterLabel(typeFilter));
  if (searchQuery.trim()) parts.push(`“${searchQuery.trim()}”`);
  if (visibleCount !== libraryCount && !showFavorites && !showRecent && selectedCabinetId === null) {
    parts.push(`库内 ${libraryCount}`);
  }

  return (
    <>
    <footer
      data-region="statusbar"
      aria-label="工作区状态"
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] px-3 text-[13px] text-[var(--text-faint)]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="status-led shrink-0" aria-hidden="true" />
        <span className="data-readout min-w-0 truncate text-[var(--text-muted)]">
          {parts.join(" / ")}
        </span>
        {searchPending && (
          <span
            data-testid="search-pending"
            role="status"
            aria-live="polite"
            aria-label="正在搜索"
            className="inline-flex shrink-0 items-center gap-1 text-[var(--accent-primary)]"
            title={`正在等待输入停顿后搜索“${inputValue.trim()}”`}
          >
            <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden="true" />
            搜索中…
          </span>
        )}
        {missingCount > 0 && (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            aria-label={`${missingCount} 个失效项目，打开待处理`}
            className="inline-flex h-6 min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[var(--status-warning-bg)] px-1.5 font-medium text-[var(--color-warning-ink)] hover:border-[var(--color-warning)]"
            title="查看失效项目：可尝试找回全部，或勾选后从库中移除。"
          >
            <TriangleAlert className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {`${missingCount} 个失效 · 待处理`}
          </button>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-[var(--text-faint)] lg:flex">
        <span className="inline-flex items-center gap-1" title="按 F3 随时唤起全局搜索">
          <Search className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          <kbd className="data-readout">F3</kbd>
          随处搜索
        </span>
        <span className="h-3 w-px bg-[var(--line-hairline)]" aria-hidden="true" />
        <span className="data-readout inline-flex items-center gap-1">
          <ArrowUpDown className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          {sortModeLabel(sortMode)}
        </span>
        <span className="h-3 w-px bg-[var(--line-hairline)]" aria-hidden="true" />
        <span className="inline-flex items-center gap-1">
          <Command className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          命令面板
        </span>
      </div>
    </footer>
    <MissingItemsReviewDialog
      open={reviewOpen}
      items={missingItems}
      relocating={relocating}
      onClose={() => setReviewOpen(false)}
      onRelocate={handleRelocate}
      onRemove={onRemoveMissing}
    />
    </>
  );
}

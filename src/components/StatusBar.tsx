import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { useSearch } from "../hooks/useSearch";
import { sortModeLabel, typeFilterLabel } from "../lib/itemQuery";
import { showToast } from "../lib/toast";

export function StatusBar({
  visibleCount,
  selectedCount,
  libraryCount,
  missingCount,
  onRelocateMissing,
}: {
  visibleCount: number;
  selectedCount: number;
  libraryCount: number;
  /** 库内已失效（文件丢失/跨盘移动）的对象数，>0 时显示可操作的找回入口。 */
  missingCount: number;
  /** 手动触发按内容签名跨盘找回，返回成功找回的对象数。 */
  onRelocateMissing: () => Promise<number>;
}) {
  const { searchQuery, inputValue } = useSearch();
  const sortMode = useAppStore((state) => state.sortMode);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const [relocating, setRelocating] = useState(false);

  const handleRelocate = async () => {
    if (relocating) return;
    setRelocating(true);
    try {
      const recovered = await onRelocateMissing();
      // 找回成功的 toast 由 useItems 统一弹出；这里只补"未找到"的反馈,
      // 手动点击必须有可感知结果,不能保持安静。
      if (recovered === 0) {
        showToast("未能自动找回失效对象：请确认磁盘已连接；文件恢复后会自动重新关联", "info");
      }
    } finally {
      setRelocating(false);
    }
  };

  const scope = showFavorites
    ? "收藏夹"
    : showRecent
      ? "最近使用"
      : selectedCabinetId !== null
        ? "文件柜"
        : selectedTagIds.length > 0
          ? `${selectedTagIds.length} 个标签`
          : "全部";

  // 防抖窗口内（输入已敲下、搜索词尚未生效）显示"搜索中"指示，
  // 让用户知道当前计数/列表对应的还是上一次搜索词。
  const searchPending = inputValue !== searchQuery;

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
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{parts.join(" · ")}</span>
        {searchPending && (
          <span
            data-testid="search-pending"
            role="status"
            aria-label="正在搜索"
            className="inline-flex shrink-0 items-center gap-1 text-[var(--accent-primary)]"
            title={`正在等待输入停顿后搜索“${inputValue.trim()}”`}
          >
            <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            搜索中…
          </span>
        )}
        {missingCount > 0 && (
          <button
            type="button"
            onClick={() => void handleRelocate()}
            disabled={relocating}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 font-medium text-[var(--color-warning)] hover:border-[var(--color-warning)] disabled:cursor-wait disabled:opacity-70"
            title="部分对象的文件已丢失或移动到其他磁盘。点击按内容签名扫描候选磁盘尝试找回。"
          >
            <svg className={`h-3 w-3 ${relocating ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {relocating ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.75m14.5 2a8 8 0 0 0-14.5-2M20 20v-5h-.75m-14.5-2a8 8 0 0 0 14.5 2" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              )}
            </svg>
            {relocating ? "正在扫描候选磁盘…" : `${missingCount} 个失效 · 尝试找回`}
          </button>
        )}
      </div>
      <span className="shrink-0">排序 {sortModeLabel(sortMode)} · Ctrl+K 命令</span>
    </footer>
  );
}

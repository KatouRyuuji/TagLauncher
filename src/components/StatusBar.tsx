import { useState } from "react";
import { ArrowUpDown, Command, LoaderCircle, TriangleAlert } from "lucide-react";
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
    } catch (err) {
      // 扫描失败（如磁盘不可读）：明确错误反馈，不能静默——用户点击后必须知道发生了什么
      showToast(`找回失效对象失败：${err instanceof Error ? err.message : String(err)}`, "error");
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
      aria-label="工作区状态"
      className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] px-3 text-[10px] text-[var(--text-faint)]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="status-led shrink-0" aria-hidden="true" />
        <span className="instrument-label hidden shrink-0 min-[1120px]:inline">Library</span>
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
            onClick={() => void handleRelocate()}
            disabled={relocating}
            aria-busy={relocating}
            className="inline-flex h-6 min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[var(--status-warning-bg)] px-1.5 font-medium text-[var(--color-warning)] hover:border-[var(--color-warning)] disabled:cursor-wait disabled:opacity-70"
            title="部分对象的文件已丢失或移动到其他磁盘。点击按内容签名扫描候选磁盘尝试找回。"
          >
            {relocating ? (
              <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : (
              <TriangleAlert className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            )}
            {relocating ? "正在扫描候选磁盘…" : `${missingCount} 个失效 · 尝试找回`}
          </button>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-[var(--text-faint)] lg:flex">
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
  );
}

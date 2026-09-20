import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LoaderCircle, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { useSearch } from "../hooks/useSearch";
import * as db from "../lib/db";
import { relocateRecoveredCopy } from "../lib/itemActionCopy";
import { typeFilterLabel } from "../lib/itemQuery";
import {
  CARD_SIZE_SCALE_RANGE,
  CARD_SIZE_SCALE_STEP,
  ICON_SIZE_SCALE_RANGE,
} from "../lib/cardSizeVars";
import { showToast } from "../lib/toast";
import type { ItemWithTags } from "../types";
import { MissingItemsReviewDialog } from "./MissingItemsReviewDialog";

export function StatusBar({
  visibleCount,
  libraryCount,
  missingItems,
  onRelocateMissing,
  onRemoveMissing,
}: {
  visibleCount: number;
  /** 选中计数由 BatchSelectionToolbar 展示，状态栏不再消费；入参保留以兼容调用方 */
  selectedCount: number;
  libraryCount: number;
  missingItems: ItemWithTags[];
  onRelocateMissing: () => Promise<number>;
  onRemoveMissing: (ids: number[]) => Promise<void>;
}) {
  const { searchQuery, inputValue } = useSearch();
  const typeFilter = useAppStore((state) => state.typeFilter);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const reviewOpen = useAppStore((state) => state.missingReviewOpen);
  const setReviewOpen = useAppStore((state) => state.setMissingReviewOpen);
  const viewMode = useAppStore((state) => state.viewMode);
  const cardSizeScale = useAppStore((state) => state.cardSizeScale);
  const iconSizeScale = useAppStore((state) => state.iconSizeScale);
  const setCardSizeScale = useAppStore((state) => state.setCardSizeScale);
  const setIconSizeScale = useAppStore((state) => state.setIconSizeScale);
  const [relocating, setRelocating] = useState(false);
  const [lastRelocateResult, setLastRelocateResult] = useState<number | null>(null);
  const [watchCount, setWatchCount] = useState(0);
  const missingCount = missingItems.length;

  useEffect(() => {
    let alive = true;
    const load = () => {
      void db.getFolderWatchStatus()
        .then((status) => {
          if (alive) setWatchCount(status.activeCount);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (reviewOpen && missingCount === 0) {
      setReviewOpen(false);
    }
  }, [missingCount, reviewOpen, setReviewOpen]);

  useEffect(() => {
    if (!reviewOpen) {
      setLastRelocateResult(null);
    }
  }, [reviewOpen]);

  const handleRelocate = async () => {
    if (relocating) return;
    setLastRelocateResult(null);
    setRelocating(true);
    try {
      const recovered = await onRelocateMissing();
      setLastRelocateResult(recovered);
      // 找回数为 0 的说明已写在对话框横幅上（上下文最强），不再弹 toast 重复同一文案
      if (recovered > 0) {
        // 全部找回时对话框会因 missingCount===0 自动关闭，success toast 兜住结果。
        showToast(relocateRecoveredCopy(recovered), "success");
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

  // 尺寸缩放控件仅服务卡片/大图标视图；列表视图行高固定不提供
  const iconsLayout = viewMode === "icons";
  const sizeRange = iconsLayout ? ICON_SIZE_SCALE_RANGE : CARD_SIZE_SCALE_RANGE;
  const sizeScale = iconsLayout ? iconSizeScale : cardSizeScale;
  const setSizeScale = iconsLayout ? setIconSizeScale : setCardSizeScale;
  const sizeLabel = iconsLayout ? "大图标尺寸" : "卡片尺寸";
  const sizePct = Math.round(sizeScale * 100);
  const sizeProgress = ((sizeScale - sizeRange.min) / (sizeRange.max - sizeRange.min)) * 100;
  const scaleRafRef = useRef<number | null>(null);
  const pendingScaleRef = useRef(sizeScale);
  useEffect(() => () => {
    if (scaleRafRef.current !== null) cancelAnimationFrame(scaleRafRef.current);
  }, []);

  const parts = [`${visibleCount} 项目`, scope];
  // 选中计数由悬浮批量工具条承载（BatchSelectionToolbar「n 已选中」），状态栏不重复
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
        {watchCount > 0 && (
          <span
            className="inline-flex shrink-0 items-center text-[var(--text-muted)]"
            title="已手动打开监视的文件夹正在收入新文件"
          >
            {`正在监视 ${watchCount} 个文件夹`}
          </span>
        )}
        {missingCount > 0 && (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            aria-label={`${missingCount} 个失效项目，打开待处理`}
            className="inline-flex h-6 min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_65%,transparent)] bg-[var(--status-warning-bg)] px-1.5 font-medium text-[var(--color-warning-ink)] hover:border-[var(--color-warning)]"
            title="查看失效项目：可尝试找回全部，或勾选后从库中移除。"
          >
            <TriangleAlert className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {`${missingCount} 个失效 · 待处理`}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {viewMode !== "list" && (
          <div className="flex items-center gap-1" role="group" aria-label={sizeLabel}>
            <button
              type="button"
              onClick={() => setSizeScale(sizeScale - CARD_SIZE_SCALE_STEP)}
              disabled={sizeScale <= sizeRange.min}
              className="icon-button h-6 w-6"
              title={`缩小${sizeLabel}`}
              aria-label={`缩小${sizeLabel}`}
            >
              <ZoomOut className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
            </button>
            <input
              type="range"
              className="zoom-range"
              min={sizeRange.min * 100}
              max={sizeRange.max * 100}
              step={CARD_SIZE_SCALE_STEP * 100}
              value={sizePct}
              onChange={(event) => {
                // rAF 节流：拖动期每帧至多一次 store 写（且不序列化），松手才持久化
                pendingScaleRef.current = Number(event.target.value) / 100;
                if (scaleRafRef.current !== null) return;
                scaleRafRef.current = requestAnimationFrame(() => {
                  scaleRafRef.current = null;
                  setSizeScale(pendingScaleRef.current, { persist: false });
                });
              }}
              onPointerUp={() => {
                if (scaleRafRef.current !== null) {
                  cancelAnimationFrame(scaleRafRef.current);
                  scaleRafRef.current = null;
                }
                setSizeScale(pendingScaleRef.current);
              }}
              aria-label={sizeLabel}
              aria-valuetext={`${sizePct}%`}
              style={{ "--range-progress": `${sizeProgress}%` } as CSSProperties}
            />
            <button
              type="button"
              onClick={() => setSizeScale(sizeScale + CARD_SIZE_SCALE_STEP)}
              disabled={sizeScale >= sizeRange.max}
              className="icon-button h-6 w-6"
              title={`放大${sizeLabel}`}
              aria-label={`放大${sizeLabel}`}
            >
              <ZoomIn className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setSizeScale(1)}
              className="data-readout w-9 text-right hover:text-[var(--text-secondary)]"
              title="重置为默认尺寸（100%）"
              aria-label={`重置${sizeLabel}为 100%`}
            >
              {`${sizePct}%`}
            </button>
          </div>
        )}
      </div>
    </footer>
    <MissingItemsReviewDialog
      open={reviewOpen}
      items={missingItems}
      relocating={relocating}
      lastRelocateResult={lastRelocateResult}
      onClose={() => setReviewOpen(false)}
      onRelocate={handleRelocate}
      onRemove={onRemoveMissing}
    />
    </>
  );
}

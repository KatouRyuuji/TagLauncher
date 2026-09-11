// ============================================================================
// components/TagFilterBar.tsx — 主视图顶部的标签筛选条
// ----------------------------------------------------------------------------
// 标签 chips 固定在主视图顶部单行并排（电商式水平滚动标签条）：不换行，
// 超出宽度横向滚动，纵向滚轮自动转为横向滚动，右缘渐隐提示后续内容。
// 仅在标签筛选可用（全部项目视图）且存在标签时渲染；文件柜/收藏/最近
// 视图中隐藏，避免误点「全部标签」退出当前视图。
// ============================================================================

import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

export function TagFilterBar() {
  const tags = useAppStore((state) => state.tags);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const tagFilterAvailable = selectedCabinetId === null && !showFavorites && !showRecent;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 横向滚动容器：把纵向滚轮转为横向滚动，标签多时不用拖动滚动条。
  // React 的 onWheel 在根节点以 passive 注册、无法 preventDefault，须手动挂非 passive 监听。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || event.deltaX !== 0 || event.shiftKey) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [tagFilterAvailable, tags.length]);

  // 右缘渐隐提示"后面还有内容"：仅在可滚且未滚到底时加 filter-scroll-more 类
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const canScroll = el.scrollWidth > el.clientWidth + 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      el.classList.toggle("filter-scroll-more", canScroll && !atEnd);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [tagFilterAvailable, tags.length]);

  if (!tagFilterAvailable || tags.length === 0) return null;

  return (
    <div
      data-region="tagfilterbar"
      className="flex h-11 shrink-0 items-center border-b border-[var(--line-hairline)] bg-[var(--bg-surface)] px-3"
    >
      <div
        ref={scrollRef}
        role="group"
        aria-label="标签筛选"
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          onClick={() => setSelectedTagIds([])}
          aria-pressed={selectedTagIds.length === 0}
          className={`control-chip h-7 min-h-7 shrink-0 px-2.5 text-[13px] font-medium ${
            selectedTagIds.length === 0 ? "control-chip-active" : ""
          }`}
        >
          全部标签
        </button>

        {tags.map((tag) => {
          const active = selectedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTagSelection(tag.id)}
              className="inline-flex h-7 min-h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[13px] font-medium text-[var(--text-secondary)]"
              aria-pressed={active}
              title={tag.name}
              style={{
                borderColor: active
                  ? `color-mix(in srgb, ${tag.color} 65%, var(--border-default))`
                  : `color-mix(in srgb, ${tag.color} 24%, var(--border-subtle))`,
                backgroundColor: active
                  ? `color-mix(in srgb, ${tag.color} 20%, var(--bg-card))`
                  : `color-mix(in srgb, ${tag.color} 7%, transparent)`,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                boxShadow: active ? `inset 0 -2px 0 ${tag.color}` : "none",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-[1px]"
                style={{ backgroundColor: tag.color }}
                aria-hidden="true"
              />
              <span>{tag.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

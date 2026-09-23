// ============================================================================
// components/TagFilterBar.tsx — 主视图顶部的已生效标签芯片
// ----------------------------------------------------------------------------
// 只展示当前正选 / 反选的标签，不铺全量目录。选标签仍以侧栏为主；
// 顶栏芯片可点掉或右键切换排除。文件柜 / 收藏 / 最近 视图中隐藏。
// ============================================================================

import { Fragment, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../stores/appStore";

export function TagFilterBar() {
  const tags = useAppStore((state) => state.tags);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const toggleTagExclusion = useAppStore((state) => state.toggleTagExclusion);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const tagFilterAvailable = selectedCabinetId === null && !showFavorites && !showRecent;
  const activeTags = tags.filter((tag) => selectedTagIds.includes(tag.id) || excludedTagIds.includes(tag.id));
  const scrollRef = useRef<HTMLDivElement>(null);

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
  }, [tagFilterAvailable, activeTags.length]);

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
    if (typeof ResizeObserver === "undefined") {
      return () => el.removeEventListener("scroll", update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [tagFilterAvailable, activeTags.length]);

  if (!tagFilterAvailable || activeTags.length === 0) return null;

  return (
    <div
      data-region="tagfilterbar"
      className="flex h-11 shrink-0 items-center bg-[var(--bg-surface)] px-3"
    >
      <div
        ref={scrollRef}
        role="group"
        aria-label="已选标签（同时满足）"
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          onClick={() => setSelectedTagIds([])}
          className="control-chip h-7 min-h-7 shrink-0 px-2.5 text-[13px] font-medium"
        >
          清除标签筛选
        </button>

        {activeTags.map((tag, index) => {
          const active = selectedTagIds.includes(tag.id);
          const excluded = excludedTagIds.includes(tag.id);
          return (
            <Fragment key={tag.id}>
              {index > 0 && activeTags.length >= 2 && (
                <span aria-hidden="true" className="shrink-0 text-[12px] text-[var(--text-faint)]">
                  {excluded ? "且非" : "且"}
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleTagSelection(tag.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  toggleTagExclusion(tag.id);
                }}
                className={`inline-flex h-7 min-h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[13px] font-medium ${
                  excluded ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"
                }`}
                aria-pressed={active}
                aria-label={excluded ? `${tag.name}（已排除）` : undefined}
                data-excluded={excluded || undefined}
                title={excluded ? `${tag.name}（已排除，点击取消）` : `${tag.name}（点击取消筛选，右键改为排除）`}
                style={excluded
                  ? {
                      borderColor: "transparent",
                      backgroundColor: "var(--bg-hover)",
                      boxShadow: "none",
                    }
                  : {
                      borderColor: "transparent",
                      backgroundColor: active
                        ? `color-mix(in srgb, ${tag.color} 10%, var(--bg-card))`
                        : "var(--bg-hover)",
                      color: active ? `color-mix(in srgb, ${tag.color} 88%, var(--text-primary))` : "var(--text-secondary)",
                      boxShadow: "none",
                    }}
              >
                {excluded && <span aria-hidden="true" className="text-[11px] font-semibold">非</span>}
                <span className={excluded ? "line-through" : undefined}>{tag.name}</span>
                <X className="h-3 w-3 opacity-60" strokeWidth={1.8} aria-hidden="true" />
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { ListFilter } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { TYPE_FILTERS, nextTypeFilter } from "../lib/itemQuery";

export function TagFilterBar() {
  const tags = useAppStore((state) => state.tags);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 筛选条是水平滚动容器：把纵向滚轮转为横向滚动，标签多时不用拖动滚动条。
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
  }, []);

  return (
    <div
      data-region="filterbar"
      className="flex h-10 shrink-0 items-center border-b border-[var(--line-hairline)] bg-[color-mix(in_srgb,var(--bg-card)_84%,transparent)] px-3"
    >
      <div className="mr-2 flex shrink-0 items-center gap-1.5 border-r border-[var(--line-hairline)] pr-2 text-[var(--text-faint)]">
        <ListFilter className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        <span className="instrument-label">筛选</span>
      </div>

      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden"
      >
        <div role="group" aria-label="文件类型筛选" className="segmented-control h-8 shrink-0">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setTypeFilter(nextTypeFilter(typeFilter, filter.value))}
              aria-pressed={typeFilter === filter.value}
              className={`control-chip h-6 min-h-6 shrink-0 rounded-[var(--radius-sm)] border-0 px-2.5 text-[11px] font-medium ${
                typeFilter === filter.value ? "control-chip-active" : ""
              }`}
              title={typeFilter === filter.value && filter.value !== "all" ? "再次点击取消筛选" : filter.label}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <span className="h-5 w-px shrink-0 bg-[var(--line-hairline)]" aria-hidden="true" />
        )}

        {tags.length > 0 && (
          <div role="group" aria-label="标签筛选" className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedTagIds([])}
              aria-pressed={selectedTagIds.length === 0}
              className={`control-chip h-7 min-h-7 shrink-0 px-2.5 text-[11px] font-medium ${
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
                  className="inline-flex h-7 min-h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-[11px] font-medium text-[var(--text-secondary)]"
                  aria-pressed={active}
                  title={tag.name}
                  style={{
                    borderColor: active
                      ? `color-mix(in srgb, ${tag.color} 48%, var(--border-default))`
                      : `color-mix(in srgb, ${tag.color} 24%, var(--border-subtle))`,
                    backgroundColor: active
                      ? `color-mix(in srgb, ${tag.color} 17%, var(--bg-card))`
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
        )}
      </div>
    </div>
  );
}

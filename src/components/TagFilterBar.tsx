import { useAppStore } from "../stores/appStore";
import { TYPE_FILTERS } from "../lib/itemQuery";

export function TagFilterBar() {
  const tags = useAppStore((state) => state.tags);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);

  return (
    <div
      data-region="filterbar"
      className="border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_72%,transparent)] px-5 py-3"
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setTypeFilter(filter.value)}
            className={`control-chip shrink-0 min-h-[30px] px-3 text-[11px] font-medium ${
              typeFilter === filter.value ? "control-chip-active" : ""
            }`}
          >
            {filter.label}
          </button>
        ))}

        {tags.length > 0 && <span className="mx-1 h-4 w-px shrink-0 bg-[var(--border-subtle)]" />}

        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedTagIds([])}
            className={`control-chip shrink-0 min-h-[30px] px-3 text-[11px] font-medium ${
              selectedTagIds.length === 0 ? "control-chip-active" : ""
            }`}
          >
            全部标签
          </button>
        )}

        {tags.map((tag) => {
          const active = selectedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTagSelection(tag.id)}
              className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-full)] border px-3 py-1.5 text-[11px] font-medium"
              style={{
                borderColor: active
                  ? `color-mix(in srgb, ${tag.color} 42%, transparent)`
                  : `color-mix(in srgb, ${tag.color} 22%, transparent)`,
                backgroundColor: active
                  ? `color-mix(in srgb, ${tag.color} 18%, var(--bg-card))`
                  : `color-mix(in srgb, ${tag.color} 10%, transparent)`,
                color: active ? tag.color : `color-mix(in srgb, ${tag.color} 76%, var(--text-secondary))`,
                boxShadow: active ? `0 10px 24px color-mix(in srgb, ${tag.color} 12%, transparent)` : "none",
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
              <span>{tag.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

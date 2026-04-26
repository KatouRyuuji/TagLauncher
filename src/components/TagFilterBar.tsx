import { useAppStore } from "../stores/appStore";

export function TagFilterBar() {
  const tags = useAppStore((state) => state.tags);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const toggleTagSelection = useAppStore((state) => state.toggleTagSelection);
  const setSelectedTagIds = useAppStore((state) => state.setSelectedTagIds);

  if (tags.length === 0) return null;

  return (
    <div
      data-region="filterbar"
      className="border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_72%,transparent)] px-5 py-3"
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setSelectedTagIds([])}
          className={`control-chip shrink-0 text-xs font-medium ${
            selectedTagIds.length === 0 ? "control-chip-active" : ""
          }`}
        >
          全部
        </button>

        {tags.map((tag) => {
          const active = selectedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTagSelection(tag.id)}
              className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-full)] border px-3 py-2 text-xs font-medium"
              style={{
                borderColor: active
                  ? `color-mix(in srgb, ${tag.color} 42%, transparent)`
                  : `color-mix(in srgb, ${tag.color} 22%, transparent)`,
                backgroundColor: active
                  ? `color-mix(in srgb, ${tag.color} 18%, white)`
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

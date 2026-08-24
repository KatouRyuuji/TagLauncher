interface FavoriteStarProps {
  active: boolean;
  onClick?: () => void;
}

export function FavoriteStar({ active, onClick }: FavoriteStarProps) {
  return (
    <button
      type="button"
      aria-label={active ? "取消收藏" : "加入收藏"}
      title={active ? "取消收藏" : "加入收藏"}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-full)] transition-colors ${
        active
          ? "bg-[color-mix(in_srgb,var(--color-favorite)_14%,transparent)] text-[var(--color-favorite)]"
          : "text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--color-favorite)] focus-visible:opacity-100"
      }`}
    >
      <svg
        className="h-3.5 w-3.5 shrink-0"
        fill={active ? "currentColor" : "none"}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={active ? 0 : 1.8}
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
  );
}

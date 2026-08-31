import { Star } from "lucide-react";

interface FavoriteStarProps {
  active: boolean;
  onClick?: () => void;
}

export function FavoriteStar({ active, onClick }: FavoriteStarProps) {
  return (
    <button
      type="button"
      aria-label={active ? "取消收藏" : "加入收藏"}
      aria-pressed={active}
      title={active ? "取消收藏" : "加入收藏"}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-[color,background-color,opacity] ${
        active
          ? "bg-[color-mix(in_srgb,var(--color-favorite)_14%,transparent)] text-[var(--color-favorite)]"
          : "text-[var(--text-faint)] opacity-40 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--color-favorite)] focus-visible:opacity-100"
      }`}
    >
      <Star
        className="h-3.5 w-3.5 shrink-0"
        fill={active ? "currentColor" : "none"}
        strokeWidth={active ? 0 : 1.8}
        aria-hidden="true"
      />
    </button>
  );
}

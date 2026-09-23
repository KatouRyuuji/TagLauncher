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
      // 卡片/行是单一 Tab 停点（roving focus）：星标退出 Tab 序，键盘用 Ctrl+D 收藏
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-[color,background-color,opacity] ${
        active
          ? "text-[var(--color-favorite)] hover:bg-[var(--bg-hover)]"
          : "text-[var(--text-faint)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--color-favorite)] focus-visible:opacity-100"
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

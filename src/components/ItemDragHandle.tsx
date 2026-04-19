export function ItemDragHandle({
  onPointerDown,
  className = "",
}: {
  onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => void;
  className?: string;
}) {
  return (
    <span
      data-item-drag="true"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--text-faint)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] cursor-grab active:cursor-grabbing ${className}`}
      title="拖拽到文件柜"
      aria-label="拖拽到文件柜"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M6 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM6 12a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
      </svg>
    </span>
  );
}

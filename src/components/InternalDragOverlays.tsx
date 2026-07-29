import { useInternalDragStore } from "../stores/internalDragStore";

/** 内部拖拽时跟随指针的幽灵提示 */
export function InternalDragGhost() {
  const activeInternalDrag = useInternalDragStore((state) => state.drag);
  if (!activeInternalDrag) return null;

  return (
    <div
      className="fixed pointer-events-none"
      style={{
        zIndex: "var(--z-drag-ghost)" as unknown as number,
        left: `calc(${activeInternalDrag.x}px + var(--drag-ghost-offset-x))`,
        top:  `calc(${activeInternalDrag.y}px + var(--drag-ghost-offset-y))`,
      }}
    >
      <div className="inline-flex items-center gap-2 rounded-none px-3 py-1.5 text-xs shadow-2xl" style={{ backgroundColor: "var(--bg-elevated)", borderWidth: "var(--border-width)" as unknown as number, borderStyle: "var(--border-style)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
        {"color" in activeInternalDrag && (
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: activeInternalDrag.color }}
          />
        )}
        <span className="max-w-[220px] truncate">
          {activeInternalDrag.kind === "item" ? `添加对象: ${activeInternalDrag.label}` : activeInternalDrag.label}
        </span>
      </div>
    </div>
  );
}

/** 拖拽对象时主内容区底部的两个落点操作区（清当前筛选 / 从应用移除） */
export function ItemDropActions({
  visible,
  mode,
  enabled,
}: {
  visible: boolean;
  mode: "tags" | "cabinet";
  enabled: boolean;
}) {
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  if (!visible) return null;

  const leftActive = hoverTarget?.kind === "item-clear-current-filter";
  const rightActive = hoverTarget?.kind === "item-remove-from-app";
  const leftTitle = enabled
    ? mode === "tags"
      ? "清空当前标签"
      : "移出当前文件夹"
    : "选择标签或文件夹后可用";
  const leftDescription = enabled
    ? mode === "tags"
      ? "从对象上移除当前激活标签"
      : "对象保留在应用中"
    : "当前没有可清理的分类筛选";

  return (
    <div className="pointer-events-none absolute inset-x-5 bottom-8 z-40 grid grid-cols-2 gap-6">
      <div
        data-drop-item-clear-current-filter={enabled ? 1 : 0}
        className={`pointer-events-auto flex min-h-[120px] items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 text-center shadow-[var(--shadow-sm)] ${
          enabled
            ? leftActive
              ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
              : "border-[color-mix(in_srgb,var(--accent-primary)_34%,transparent)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] text-[var(--text-secondary)]"
            : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_68%,transparent)] text-[var(--text-faint)]"
        }`}
      >
        <div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-elevated)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M9 8l-4 4 4 4" />
            </svg>
          </div>
          <p className="text-sm font-semibold">{leftTitle}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{leftDescription}</p>
        </div>
      </div>

      <div
        data-drop-item-remove-from-app={1}
        className={`pointer-events-auto flex min-h-[120px] items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 text-center shadow-[var(--shadow-sm)] ${
          rightActive
            ? "border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
            : "border-[color-mix(in_srgb,var(--color-danger)_34%,transparent)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] text-[var(--text-secondary)]"
        }`}
      >
        <div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-elevated)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12m-8 4v6m4-6v6M9 7l1-2h4l1 2m-8 0 1 13h8l1-13" />
            </svg>
          </div>
          <p className="text-sm font-semibold">从应用移除</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">不删除本地文件</p>
        </div>
      </div>
    </div>
  );
}

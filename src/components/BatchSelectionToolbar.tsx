import { useEffect, useState } from "react";

/** 主内容区底部的批量操作工具条（选中对象时出现） */
export function BatchSelectionToolbar({
  selectedCount,
  tags,
  removableTags,
  cabinets,
  canRemoveFromCabinet,
  onAddTag,
  onRemoveTag,
  onAddToCabinet,
  onRemoveFromCabinet,
  onRemoveFromApp,
  onClearSelection,
}: {
  selectedCount: number;
  tags: Array<{ id: number; name: string; color: string }>;
  removableTags: Array<{ id: number; name: string; color: string }>;
  cabinets: Array<{ id: number; name: string; color: string }>;
  canRemoveFromCabinet: boolean;
  onAddTag: (tagId: number) => Promise<void>;
  onRemoveTag: (tagId: number) => Promise<void>;
  onAddToCabinet: (cabinetId: number) => Promise<void>;
  onRemoveFromCabinet: () => Promise<void>;
  onRemoveFromApp: () => Promise<void>;
  onClearSelection: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<"add-tag" | "remove-tag" | "cabinet" | null>(null);

  useEffect(() => {
    if (!openMenu) return;

    const close = () => setOpenMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);

  if (selectedCount === 0) return null;

  const runAction = (action: () => Promise<void>) => {
    setOpenMenu(null);
    void action();
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-5 bottom-8 z-50 flex justify-center"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="surface-card pointer-events-auto flex max-w-[calc(100vw-var(--sidebar-width)-40px)] items-center gap-2 px-3 py-2 shadow-[var(--shadow-dropdown)]">
        <div className="flex items-center gap-2 border-r border-[var(--border-subtle)] pr-3 text-sm font-semibold text-[var(--text-primary)]">
          <span className="flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent-primary)] px-2 text-xs text-[var(--text-invert)]">
            {selectedCount}
          </span>
          已选中
        </div>

        <ToolbarMenuButton
          label="加入标签"
          open={openMenu === "add-tag"}
          onClick={() => setOpenMenu(openMenu === "add-tag" ? null : "add-tag")}
        >
          {tags.length === 0 ? (
            <MenuEmptyText>暂无标签</MenuEmptyText>
          ) : (
            tags.map((tag) => (
              <MenuOption key={tag.id} color={tag.color} label={tag.name} onClick={() => runAction(() => onAddTag(tag.id))} />
            ))
          )}
        </ToolbarMenuButton>

        <ToolbarMenuButton
          label="移除标签"
          open={openMenu === "remove-tag"}
          onClick={() => setOpenMenu(openMenu === "remove-tag" ? null : "remove-tag")}
        >
          {removableTags.length === 0 ? (
            <MenuEmptyText>选中对象没有可移除标签</MenuEmptyText>
          ) : (
            removableTags.map((tag) => (
              <MenuOption key={tag.id} color={tag.color} label={tag.name} onClick={() => runAction(() => onRemoveTag(tag.id))} />
            ))
          )}
        </ToolbarMenuButton>

        <ToolbarMenuButton
          label="文件夹"
          open={openMenu === "cabinet"}
          onClick={() => setOpenMenu(openMenu === "cabinet" ? null : "cabinet")}
        >
          {cabinets.length === 0 ? (
            <MenuEmptyText>暂无文件夹</MenuEmptyText>
          ) : (
            cabinets.map((cabinet) => (
              <MenuOption key={cabinet.id} color={cabinet.color} label={`加入 ${cabinet.name}`} onClick={() => runAction(() => onAddToCabinet(cabinet.id))} />
            ))
          )}
          <button
            type="button"
            disabled={!canRemoveFromCabinet}
            onClick={() => runAction(onRemoveFromCabinet)}
            className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
          >
            从当前文件夹移出
          </button>
        </ToolbarMenuButton>

        <button
          type="button"
          onClick={() => void onRemoveFromApp()}
          className="action-button text-[var(--color-danger)] hover:text-[var(--color-danger-hover)]"
        >
          批量删除
        </button>
        <button type="button" onClick={onClearSelection} className="action-button">
          取消选择
        </button>
      </div>
    </div>
  );
}

function ToolbarMenuButton({
  label,
  open,
  onClick,
  children,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button type="button" onClick={onClick} className={`action-button ${open ? "border-[var(--accent-primary)] text-[var(--accent-primary)]" : ""}`}>
        {label}
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 max-h-[260px] min-w-[190px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-dropdown)]">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuOption({
  color,
  label,
  onClick,
}: {
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function MenuEmptyText({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-sm text-[var(--text-faint)]">{children}</div>;
}

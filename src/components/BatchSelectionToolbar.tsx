import { useEffect, useState } from "react";
import {
  CheckCheck,
  ChevronUp,
  Copy,
  FolderPlus,
  LoaderCircle,
  Star,
  Tag,
  Tags,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { stepMenuIndex } from "../lib/itemQuery";

/** 主内容区底部的批量操作工具条（选中对象时出现） */
export function BatchSelectionToolbar({
  selectedCount,
  totalCount,
  tags,
  removableTags,
  cabinets,
  canRemoveFromCabinet,
  onAddTag,
  onRemoveTag,
  onAddToCabinet,
  onRemoveFromCabinet,
  onRemoveFromApp,
  favoriteLabel,
  onToggleFavorite,
  onCopyPaths,
  onSelectAll,
  onClearSelection,
}: {
  selectedCount: number;
  /** 当前结果集总数（用于"全选当前结果"兜底，覆盖虚拟化未渲染的条目）。 */
  totalCount: number;
  tags: Array<{ id: number; name: string; color: string }>;
  removableTags: Array<{ id: number; name: string; color: string }>;
  cabinets: Array<{ id: number; name: string; color: string }>;
  canRemoveFromCabinet: boolean;
  onAddTag: (tagId: number) => Promise<void>;
  onRemoveTag: (tagId: number) => Promise<void>;
  onAddToCabinet: (cabinetId: number) => Promise<void>;
  onRemoveFromCabinet: () => Promise<void>;
  onRemoveFromApp: () => Promise<void>;
  /** 批量收藏按钮文案："收藏"（选中含未收藏项）或"取消收藏"（已全部收藏）。 */
  favoriteLabel: string;
  onToggleFavorite: () => void;
  onCopyPaths: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<"add-tag" | "remove-tag" | "cabinet" | null>(null);
  // 批量操作进行中：禁用全部操作入口防止重复提交（大批量写库有可感知耗时），
  // 并以 aria-busy + spinner 让用户知道操作正在执行而非无响应。
  const [busy, setBusy] = useState(false);

  useEscapeKey(() => setOpenMenu(null), openMenu !== null);

  useEffect(() => {
    if (selectedCount === 0 && openMenu !== null) setOpenMenu(null);
  }, [selectedCount, openMenu]);

  useEffect(() => {
    if (!openMenu) return;

    const close = () => setOpenMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const root = document.querySelector("[data-floating-menu]");
      if (!(root instanceof HTMLElement)) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (items.length === 0) return;
      const active = event.target instanceof HTMLElement ? event.target : null;
      const current = items.findIndex((el) => el === active || (active !== null && el.contains(active)));
      const next = stepMenuIndex(items.length, current, event.key);
      if (next == null) return;
      event.preventDefault();
      items[next]?.focus();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openMenu]);

  if (selectedCount === 0) return null;

  const runAction = (action: () => Promise<void>) => {
    if (busy) return;
    setOpenMenu(null);
    setBusy(true);
    // 失败提示已由批量动作链路（withErrorToast）统一弹出，吞掉 rejection 避免噪音
    void action()
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-2 bottom-10 z-50 flex justify-center sm:inset-x-5"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        data-testid="batch-toolbar"
        aria-busy={busy}
        className="surface-card pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto px-2 py-1.5 shadow-[var(--shadow-dropdown)] sm:max-w-[calc(100vw-var(--sidebar-width)-40px)]"
      >
        <div className="flex items-center gap-2 border-r border-[var(--border-subtle)] pr-3 text-sm font-semibold text-[var(--text-primary)]">
          <span className="data-readout flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-2 text-xs text-[var(--text-invert)]">
            {busy ? (
              <LoaderCircle data-testid="batch-busy-spinner" aria-hidden="true" size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              selectedCount
            )}
          </span>
          {busy ? "处理中…" : "已选中"}
        </div>

        <ToolbarMenuButton
          label="加入标签"
          icon={Tag}
          disabled={busy}
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
          icon={Tags}
          disabled={busy}
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
          icon={FolderPlus}
          disabled={busy}
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
            role="menuitem"
            disabled={!canRemoveFromCabinet}
            onClick={() => runAction(onRemoveFromCabinet)}
            className="mt-1 flex w-full items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
          >
            从当前文件夹移出
          </button>
        </ToolbarMenuButton>

        {selectedCount < totalCount && (
          <button
            type="button"
            onClick={onSelectAll}
            disabled={busy}
            className="action-button min-h-8 shrink-0 px-2.5 text-xs"
            title="选中当前筛选结果的全部对象（含虚拟化未渲染的条目）"
          >
            <CheckCheck aria-hidden="true" size={14} strokeWidth={1.8} />
            全选 {totalCount}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFavorite}
          disabled={busy}
          className="action-button min-h-8 shrink-0 px-2.5 text-xs"
          title={`${favoriteLabel}选中对象（Ctrl+D）`}
        >
          <Star aria-hidden="true" size={14} strokeWidth={1.8} fill={favoriteLabel === "收藏" ? "none" : "currentColor"} className="text-[var(--color-favorite)]" />
          {favoriteLabel}
        </button>
        <button
          type="button"
          onClick={onCopyPaths}
          disabled={busy}
          className="action-button min-h-8 shrink-0 px-2.5 text-xs"
          title="复制选中路径（Ctrl+C，多项换行）"
        >
          <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
          复制路径
        </button>
        <button
          type="button"
          onClick={() => runAction(onRemoveFromApp)}
          disabled={busy}
          className="action-button action-button-danger min-h-8 shrink-0 px-2.5 text-xs"
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
          批量删除
        </button>
        <button type="button" onClick={onClearSelection} disabled={busy} className="action-button min-h-8 shrink-0 px-2.5 text-xs">
          <X aria-hidden="true" size={14} strokeWidth={1.8} />
          取消选择
        </button>
      </div>
    </div>
  );
}

function ToolbarMenuButton({
  label,
  icon: Icon,
  open,
  disabled,
  onClick,
  children,
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={onClick}
        className={`action-button min-h-8 shrink-0 px-2.5 text-xs ${open ? "border-[var(--accent-primary)] text-[var(--accent-primary)]" : ""}`}
      >
        <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
        {label}
        <ChevronUp aria-hidden="true" size={12} strokeWidth={1.8} className={`transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <div
          data-floating-menu=""
          data-workspace-overlay=""
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 max-h-[260px] min-w-[190px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-dropdown)]"
        >
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
      role="menuitem"
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

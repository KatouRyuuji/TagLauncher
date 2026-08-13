import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { pickFilesToAdd, pickFoldersToAdd } from "../lib/importDialogs";
import { filterCommandsByQuery, isImeKeyboardEvent, SORT_OPTIONS, TYPE_FILTERS, nextTypeFilter } from "../lib/itemQuery";
import { buildSearchIndex, searchWithIndex } from "../lib/search";
import { focusWorkspaceSearch, resetWorkspaceSearchInput } from "../lib/workspaceChrome";
import { useAppStore } from "../stores/appStore";
import { getTypeLabel } from "../lib/itemUtils";
import type { ItemWithTags } from "../types";

const PALETTE_PRIMARY = new Set([
  "search",
  "grid",
  "list",
  "favorites",
  "recent",
  "clear",
  "add-files",
  "add-folders",
  "settings",
  "shortcuts",
]);

interface CommandDef {
  id: string;
  title: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

interface CommandPaletteProps {
  items: ItemWithTags[];
  onLaunch: (id: number) => void;
  onAddItems: (paths: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export function CommandPalette({
  items,
  onLaunch,
  onAddItems,
  onRefresh,
  onOpenSettings,
  onOpenAbout,
}: CommandPaletteProps) {
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const setShowFavorites = useAppStore((state) => state.setShowFavorites);
  const showFavorites = useAppStore((state) => state.showFavorites);
  const setShowRecent = useAppStore((state) => state.setShowRecent);
  const showRecent = useAppStore((state) => state.showRecent);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);
  const typeFilter = useAppStore((state) => state.typeFilter);
  const setTagGraphOpen = useAppStore((state) => state.setTagGraphOpen);
  const setShortcutsHelpOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const clearWorkspaceFilters = useAppStore((state) => state.clearWorkspaceFilters);

  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, autoFocus: false });

  const commands = useMemo<CommandDef[]>(() => [
    { id: "search", title: "聚焦搜索", hint: "/", keywords: "search 搜索 find", run: () => focusWorkspaceSearch() },
    { id: "grid", title: "网格视图", hint: "G", keywords: "grid 网格", run: () => setViewMode("grid") },
    { id: "list", title: "列表视图", hint: "L", keywords: "list 列表", run: () => setViewMode("list") },
    { id: "favorites", title: showFavorites ? "退出收藏夹" : "打开收藏夹", keywords: "favorite 收藏 星标", run: () => setShowFavorites(!showFavorites) },
    { id: "recent", title: showRecent ? "退出最近使用" : "最近使用", keywords: "recent 最近 历史", run: () => setShowRecent(!showRecent) },
    { id: "clear", title: "清空筛选", keywords: "clear 重置 筛选", run: () => { clearWorkspaceFilters(); resetWorkspaceSearchInput(); } },
    ...SORT_OPTIONS.map((option) => ({
      id: `sort-${option.value}`,
      title: `排序：${option.label}`,
      keywords: `sort 排序 ${option.label} ${option.value}`,
      run: () => setSortMode(option.value),
    })),
    ...TYPE_FILTERS.map((filter) => ({
      id: `type-${filter.value}`,
      title: filter.value === "all" ? "取消类型筛选" : `筛选${filter.label}`,
      keywords: `filter 类型 ${filter.label} ${filter.value}`,
      run: () => setTypeFilter(nextTypeFilter(typeFilter, filter.value)),
    })),
    { id: "add-files", title: "添加文件", keywords: "import 导入 添加 文件", run: () => { void pickFilesToAdd().then((paths) => { if (paths) void onAddItems(paths); }); } },
    { id: "add-folders", title: "添加文件夹", keywords: "import 导入 添加 文件夹", run: () => { void pickFoldersToAdd().then((paths) => { if (paths) void onAddItems(paths); }); } },
    { id: "refresh", title: "刷新", keywords: "refresh 刷新 reload", run: () => { void onRefresh(); } },
    { id: "settings", title: "打开设置", hint: "Ctrl+,", keywords: "settings 设置 偏好", run: onOpenSettings },
    { id: "graph", title: "打开标签图谱", keywords: "graph 图谱 关系", run: () => setTagGraphOpen(true) },
    { id: "shortcuts", title: "快捷键一览", hint: "?", keywords: "shortcut 快捷键 help", run: () => setShortcutsHelpOpen(true) },
    { id: "about", title: "关于 TagLauncher", keywords: "about 关于 欢迎", run: onOpenAbout },
  ], [
    clearWorkspaceFilters,
    onAddItems,
    onOpenAbout,
    onOpenSettings,
    onRefresh,
    setShowFavorites,
    setShowRecent,
    showFavorites,
    showRecent,
    setSortMode,
    setTagGraphOpen,
    setTypeFilter,
    typeFilter,
    setShortcutsHelpOpen,
    setViewMode,
  ]);

  const matchedCommands = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) return commands.filter((command) => PALETTE_PRIMARY.has(command.id));
    return filterCommandsByQuery(commands, q);
  }, [commands, filterQuery]);
  const searchIndex = useMemo(
    () => (open ? buildSearchIndex(items, "all") : { entries: [], mode: "all" as const }),
    [open, items],
  );
  const matchedItems = useMemo(() => {
    if (!filterQuery.trim()) return [];
    return searchWithIndex(searchIndex, filterQuery).slice(0, 8);
  }, [searchIndex, filterQuery]);

  type Row = { kind: "command"; command: CommandDef } | { kind: "item"; item: ItemWithTags };
  const rows = useMemo<Row[]>(() => {
    const next: Row[] = matchedCommands.map((command) => ({ kind: "command", command }));
    for (const entry of matchedItems) next.push({ kind: "item", item: entry });
    return next;
  }, [matchedCommands, matchedItems]);

  useEffect(() => {
    if (!open) return;
    composingRef.current = false;
    setQuery("");
    setFilterQuery("");
    setActive(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [filterQuery]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector("[data-active-row]");
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, rows]);

  useEscapeKey(() => setOpen(false), open);

  if (!open) return null;

  const safeActive = rows.length === 0 ? 0 : Math.min(active, rows.length - 1);

  const runRow = (row: Row | undefined) => {
    if (!row) return;
    setOpen(false);
    if (row.kind === "command") {
      row.command.run();
      return;
    }
    onLaunch(row.item.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKeyboardEvent(event)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActive((current) => (Math.min(current, rows.length - 1) + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActive((current) => (Math.min(current, rows.length - 1) - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runRow(rows[safeActive]);
    } else if (event.key === "Tab") {
      const row = rows[safeActive];
      if (row?.kind === "item") {
        event.preventDefault();
        setOpen(false);
        setPreviewItemId(row.item.id);
      }
    }
  };

  return createPortal(
    <div
      data-command-palette=""
      data-workspace-overlay=""
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
      style={{ zIndex: "var(--z-command-palette)" as unknown as number }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={trapRef}
        className="modal-surface flex w-full max-w-[560px] flex-col overflow-hidden shadow-[var(--shadow-dropdown)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const value = event.currentTarget.value;
              setQuery(value);
              setFilterQuery(value);
            }}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (composingRef.current) return;
              setFilterQuery(value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索命令或项目…"
            className="w-full bg-transparent text-[15px] text-[var(--text-primary)] placeholder-[var(--text-placeholder)] outline-none"
          />
        </div>
        <div ref={listRef} className="max-h-[min(52vh,420px)] overflow-y-auto p-2">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">没有匹配的命令或项目</p>
          )}
          {rows.map((row, index) => {
            const selected = index === safeActive;
            if (row.kind === "command") {
              return (
                <button
                  key={row.command.id}
                  type="button"
                  data-active-row={selected ? "" : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => runRow(row)}
                  className={`flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left text-sm ${
                    selected ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <span>{row.command.title}</span>
                  {row.command.hint && <kbd className="kbd">{row.command.hint}</kbd>}
                </button>
              );
            }
            return (
              <button
                key={`item-${row.item.id}`}
                type="button"
                data-active-row={selected ? "" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => runRow(row)}
                className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm ${
                  selected ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]" : "text-[var(--text-secondary)]"
                }`}
              >
                <span className="min-w-0 truncate">{row.item.name}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{getTypeLabel(row.item.type)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-faint)]">
          <span>Enter 执行 · Tab 预览对象</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

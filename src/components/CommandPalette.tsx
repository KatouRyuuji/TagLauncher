import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { pickFilesToAdd, pickFoldersToAdd } from "../lib/importDialogs";
import { filterCommandsByQuery } from "../lib/itemQuery";
import { buildSearchIndex, searchWithIndex } from "../lib/search";
import { focusWorkspaceSearch, resetWorkspaceSearchInput } from "../lib/workspaceChrome";
import { useAppStore } from "../stores/appStore";
import { getTypeLabel } from "../lib/itemUtils";
import type { ItemWithTags } from "../types";

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
  const setShowRecent = useAppStore((state) => state.setShowRecent);
  const setSortMode = useAppStore((state) => state.setSortMode);
  const setTypeFilter = useAppStore((state) => state.setTypeFilter);
  const setTagGraphOpen = useAppStore((state) => state.setTagGraphOpen);
  const setShortcutsHelpOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const clearWorkspaceFilters = useAppStore((state) => state.clearWorkspaceFilters);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<CommandDef[]>(() => [
    { id: "search", title: "聚焦搜索", hint: "/", keywords: "search 搜索 find", run: () => focusWorkspaceSearch() },
    { id: "grid", title: "网格视图", hint: "G", keywords: "grid 网格", run: () => setViewMode("grid") },
    { id: "list", title: "列表视图", hint: "L", keywords: "list 列表", run: () => setViewMode("list") },
    { id: "favorites", title: "打开收藏夹", keywords: "favorite 收藏 星标", run: () => setShowFavorites(true) },
    { id: "recent", title: "最近使用", keywords: "recent 最近 历史", run: () => setShowRecent(true) },
    { id: "clear", title: "清空筛选", keywords: "clear 重置 筛选", run: () => { clearWorkspaceFilters(); resetWorkspaceSearchInput(); } },
    { id: "sort-smart", title: "排序：智能", keywords: "sort 排序", run: () => setSortMode("smart") },
    { id: "sort-name", title: "排序：名称", keywords: "sort 名称", run: () => setSortMode("name") },
    { id: "sort-recent", title: "排序：最近使用", keywords: "sort 最近", run: () => setSortMode("recent") },
    { id: "type-image", title: "筛选图片", keywords: "filter 图片 image", run: () => setTypeFilter("image") },
    { id: "type-audio", title: "筛选音频", keywords: "filter 音频 audio", run: () => setTypeFilter("audio") },
    { id: "type-exe", title: "筛选程序", keywords: "filter 程序 exe", run: () => setTypeFilter("exe") },
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
    setSortMode,
    setTagGraphOpen,
    setTypeFilter,
    setShortcutsHelpOpen,
    setViewMode,
  ]);

  const matchedCommands = useMemo(() => filterCommandsByQuery(commands, query), [commands, query]);
  const searchIndex = useMemo(() => buildSearchIndex(items, "all"), [items]);
  const matchedItems = useMemo(() => {
    if (!query.trim()) return [];
    return searchWithIndex(searchIndex, query).slice(0, 8);
  }, [searchIndex, query]);

  type Row = { kind: "command"; command: CommandDef } | { kind: "item"; item: ItemWithTags };
  const rows = useMemo<Row[]>(() => {
    const next: Row[] = matchedCommands.map((command) => ({ kind: "command", command }));
    for (const entry of matchedItems) next.push({ kind: "item", item: entry });
    return next;
  }, [matchedCommands, matchedItems]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEscapeKey(() => setOpen(false), open);

  if (!open) return null;

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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(rows.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runRow(rows[active]);
    } else if (event.key === "Tab") {
      const row = rows[active];
      if (row?.kind === "item") {
        event.preventDefault();
        setOpen(false);
        setPreviewItemId(row.item.id);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
      style={{ zIndex: "var(--z-command-palette)" as unknown as number }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        className="modal-surface flex w-full max-w-[560px] flex-col overflow-hidden shadow-[var(--shadow-dropdown)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索命令或项目…"
            className="w-full bg-transparent text-[15px] text-[var(--text-primary)] placeholder-[var(--text-placeholder)] outline-none"
          />
        </div>
        <div className="max-h-[min(52vh,420px)] overflow-y-auto p-2">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">没有匹配的命令或项目</p>
          )}
          {rows.map((row, index) => {
            const selected = index === active;
            if (row.kind === "command") {
              return (
                <button
                  key={row.command.id}
                  type="button"
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

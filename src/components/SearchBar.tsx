import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSearch } from "../hooks/useSearch";
import { notifySearchInput } from "../lib/modApi";
import { useAppStore, type SearchMode } from "../stores/appStore";
import {
  getToolbarButtons,
  subscribeToolbarButtons,
  type ToolbarButtonDescriptor,
} from "../lib/modToolbarRegistry";

interface SearchBarProps {
  onAddItems: (paths: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenAbout: () => void;
  onOpenSettings?: () => void;
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "name", label: "名称" },
  { value: "tag", label: "标签" },
];

const PLACEHOLDERS: Record<SearchMode, string> = {
  all: "搜索名称、路径或标签...",
  name: "搜索名称或路径...",
  tag: "搜索标签...",
};

export function SearchBar({ onAddItems, onRefresh, onOpenAbout, onOpenSettings }: SearchBarProps) {
  const { handleSearch } = useSearch();
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const searchMode = useAppStore((state) => state.searchMode);
  const setSearchMode = useAppStore((state) => state.setSearchMode);
  const [inputValue, setInputValue] = useState("");
  const [modButtons, setModButtons] = useState<ToolbarButtonDescriptor[]>([]);

  useEffect(() => {
    const update = () => setModButtons(getToolbarButtons());
    update();
    return subscribeToolbarButtons(update);
  }, []);

  const handleBrowse = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "可执行文件", extensions: ["exe", "bat", "ps1"] },
        { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic", "heif"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    await onAddItems(paths);
  };

  const handleBrowseFolder = async () => {
    const selected = await open({ directory: true, multiple: true });
    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    await onAddItems(paths);
  };

  return (
    <header
      data-region="searchbar"
      className="relative border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_82%,transparent)] px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-label">Workspace</div>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
            项目工作台
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            快速搜索、导入和整理你的启动项与素材目录
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onRefresh} className="icon-button" title="刷新">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.75m14.5 2a8 8 0 0 0-14.5-2M20 20v-5h-.75m-14.5-2a8 8 0 0 0 14.5 2" />
            </svg>
          </button>

          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="icon-button" title="设置">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75c1.15 0 2.1.83 2.28 1.93l.08.52a1.45 1.45 0 0 0 2.12 1.04l.46-.24a2.25 2.25 0 0 1 2.97.87c.58.99.31 2.25-.61 2.93l-.43.31a1.45 1.45 0 0 0 0 2.36l.43.31c.92.68 1.19 1.94.61 2.93a2.25 2.25 0 0 1-2.97.87l-.46-.24a1.45 1.45 0 0 0-2.12 1.04l-.08.52A2.31 2.31 0 0 1 12 20.25a2.31 2.31 0 0 1-2.28-1.93l-.08-.52a1.45 1.45 0 0 0-2.12-1.04l-.46.24a2.25 2.25 0 0 1-2.97-.87 2.23 2.23 0 0 1 .61-2.93l.43-.31a1.45 1.45 0 0 0 0-2.36l-.43-.31a2.23 2.23 0 0 1-.61-2.93 2.25 2.25 0 0 1 2.97-.87l.46.24A1.45 1.45 0 0 0 9.64 6.2l.08-.52A2.31 2.31 0 0 1 12 3.75Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Z" />
              </svg>
            </button>
          )}

          <button type="button" onClick={onOpenAbout} className="action-button">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8h.01M10.75 11.75h1.25V16h1.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            关于
          </button>

          {/* Mod Toolbar 按钮 */}
          {modButtons.map((btn) => (
            <button
              key={`${btn.modId}::${btn.id}`}
              type="button"
              data-mod-toolbar={btn.modId}
              onClick={btn.onClick}
              className="action-button"
              title={btn.text}
            >
              {btn.icon ? (
                <span
                  className="h-4 w-4"
                  dangerouslySetInnerHTML={{ __html: btn.icon }}
                />
              ) : null}
              {btn.text}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="surface-card-soft flex items-center gap-1 p-1">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setSearchMode(mode.value)}
              className={`control-chip min-h-[34px] px-4 text-xs font-medium ${
                searchMode === mode.value ? "control-chip-active" : ""
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="surface-card relative min-w-[280px] flex-1 px-4 py-3">
          <svg
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
          </svg>

          <input
            type="text"
            placeholder={PLACEHOLDERS[searchMode]}
            value={inputValue}
            onChange={(event) => {
              const value = event.target.value;
              setInputValue(value);
              handleSearch(value);
              notifySearchInput(value);
            }}
            className="w-full border-0 bg-transparent pl-7 pr-10 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none"
          />

          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue("");
                handleSearch("");
                notifySearchInput("");
              }}
              className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-full)] text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              title="清空搜索"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>

        <div className="surface-card-soft flex items-center gap-1 p-1">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`control-chip min-h-[34px] px-3 ${viewMode === "grid" ? "control-chip-active" : ""}`}
            title="网格视图"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.25A1.25 1.25 0 0 1 2.25 1h4.5A1.25 1.25 0 0 1 8 2.25v4.5A1.25 1.25 0 0 1 6.75 8h-4.5A1.25 1.25 0 0 1 1 6.75v-4.5Zm7 0A1.25 1.25 0 0 1 9.25 1h4.5A1.25 1.25 0 0 1 15 2.25v4.5A1.25 1.25 0 0 1 13.75 8h-4.5A1.25 1.25 0 0 1 8 6.75v-4.5Zm-7 7A1.25 1.25 0 0 1 2.25 8h4.5A1.25 1.25 0 0 1 8 9.25v4.5A1.25 1.25 0 0 1 6.75 15h-4.5A1.25 1.25 0 0 1 1 13.75v-4.5Zm7 0A1.25 1.25 0 0 1 9.25 8h4.5A1.25 1.25 0 0 1 15 9.25v4.5A1.25 1.25 0 0 1 13.75 15h-4.5A1.25 1.25 0 0 1 8 13.75v-4.5Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`control-chip min-h-[34px] px-3 ${viewMode === "list" ? "control-chip-active" : ""}`}
            title="列表视图"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3.25A1.25 1.25 0 0 1 3.25 2h9.5a1.25 1.25 0 1 1 0 2.5h-9.5A1.25 1.25 0 0 1 2 3.25Zm0 4.75A1.25 1.25 0 0 1 3.25 6.75h9.5a1.25 1.25 0 1 1 0 2.5h-9.5A1.25 1.25 0 0 1 2 8Zm0 4.75a1.25 1.25 0 0 1 1.25-1.25h9.5a1.25 1.25 0 1 1 0 2.5h-9.5A1.25 1.25 0 0 1 2 12.75Z" />
            </svg>
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleBrowse} className="action-button">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
            </svg>
            添加文件
          </button>

          <button type="button" onClick={handleBrowseFolder} className="action-button action-button-primary">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h3.19a1.5 1.5 0 0 1 1.06.44l1.62 1.62c.28.28.66.44 1.06.44H18A2.25 2.25 0 0 1 20.25 10v6A2.25 2.25 0 0 1 18 18.25H6A2.25 2.25 0 0 1 3.75 16V7.5Z" />
            </svg>
            添加文件夹
          </button>
        </div>
      </div>
    </header>
  );
}

// ============================================================================
// components/SearchBar.tsx — 顶部搜索栏
// ============================================================================
// 功能：
// 1. 搜索模式切换（全部/名称/标签）
// 2. 搜索输入框（带清空按钮，150ms 防抖）
// 3. 视图模式切换（网格/列表）
// 4. 刷新按钮
// 5. 添加文件/文件夹按钮（调用 Tauri 原生文件选择对话框）
// ============================================================================

import { useState } from "react";
import { useSearch } from "../hooks/useSearch";
import { useAppStore, type SearchMode } from "../stores/appStore";
import { open } from "@tauri-apps/plugin-dialog";
import { notifySearchInput } from "../lib/modApi";

interface SearchBarProps {
  onAddItem: (path: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenAbout: () => void;
  onOpenSettings?: () => void;
}

/** 搜索模式选项 */
const MODES: { value: SearchMode; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "name", label: "名称" },
  { value: "tag", label: "标签" },
];

/** 各模式的搜索框占位文字 */
const PLACEHOLDERS: Record<SearchMode, string> = {
  all: "搜索名称、路径或标签...",
  name: "搜索名称或路径...",
  tag: "搜索标签...",
};

export function SearchBar({ onAddItem, onRefresh, onOpenAbout, onOpenSettings }: SearchBarProps) {
  const { handleSearch } = useSearch();
  const { viewMode, setViewMode, searchMode, setSearchMode } = useAppStore();
  // inputValue 是输入框的即时值，searchQuery 是防抖后的值
  const [inputValue, setInputValue] = useState("");

  /** 浏览文件：弹出原生文件选择对话框 */
  const handleBrowse = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "可执行文件", extensions: ["exe", "bat", "ps1"] },
        { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic", "heif"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        await onAddItem(path);
      }
    }
  };

  /** 浏览文件夹：弹出原生目录选择对话框 */
  const handleBrowseFolder = async () => {
    const selected = await open({ directory: true, multiple: true });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        await onAddItem(path);
      }
    }
  };

  return (
    <header data-region="searchbar" className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center gap-3 bg-[var(--bg-base)]">
      {/* 搜索模式切换按钮组 */}
      <div className="flex bg-[var(--bg-hover)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-0.5">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setSearchMode(m.value)}
            className={`px-2.5 py-1 rounded-[var(--radius-md)] text-xs transition-colors ${
              searchMode === m.value
                ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-tertiary)]"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* 搜索输入框 */}
      <div className="flex-1 relative">
        {/* 搜索图标 */}
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder={PLACEHOLDERS[searchMode]}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            handleSearch(e.target.value);
            notifySearchInput(e.target.value);
          }}
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] pl-9 pr-8 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none focus:border-[var(--accent-primary)] focus:bg-[var(--bg-hover)] transition-all"
        />
        {/* 清空按钮（有输入内容时显示） */}
        {inputValue && (
          <button
            onClick={() => { setInputValue(""); handleSearch(""); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-tertiary)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 视图模式切换：网格 / 列表 */}
      <div className="flex bg-[var(--bg-hover)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-0.5">
        <button
          onClick={() => setViewMode("grid")}
          className={`p-1.5 rounded-[var(--radius-md)] transition-colors ${viewMode === "grid" ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-tertiary)]"}`}
          title="网格视图"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <path d="M1 2.5A1.5 1.5 0 012.5 1h3A1.5 1.5 0 017 2.5v3A1.5 1.5 0 015.5 7h-3A1.5 1.5 0 011 5.5v-3zm8 0A1.5 1.5 0 0110.5 1h3A1.5 1.5 0 0115 2.5v3A1.5 1.5 0 0113.5 7h-3A1.5 1.5 0 019 5.5v-3zm-8 8A1.5 1.5 0 012.5 9h3A1.5 1.5 0 017 10.5v3A1.5 1.5 0 015.5 15h-3A1.5 1.5 0 011 13.5v-3zm8 0A1.5 1.5 0 0110.5 9h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 019 13.5v-3z"/>
          </svg>
        </button>
        <button
          onClick={() => setViewMode("list")}
          className={`p-1.5 rounded-[var(--radius-md)] transition-colors ${viewMode === "list" ? "bg-[var(--bg-active)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-tertiary)]"}`}
          title="列表视图"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
            <path fillRule="evenodd" d="M2.5 12a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5zm0-4a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5zm0-4a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5z"/>
          </svg>
        </button>
      </div>

      {/* 刷新按钮 */}
      <button onClick={onRefresh} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors" title="刷新">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      {/* 设置按钮 */}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          title="设置"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      {/* 关于我按钮 */}
      <button
        onClick={onOpenAbout}
        className="px-3 py-2 bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] text-sm text-[var(--text-tertiary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] transition-all"
      >
        关于我
      </button>

      {/* 添加文件/文件夹按钮 */}
      <div className="flex gap-1.5">
        <button
          onClick={handleBrowse}
          className="px-3 py-2 bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] text-sm text-[var(--text-tertiary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] transition-all"
        >
          + 文件
        </button>
        <button
          onClick={handleBrowseFolder}
          className="px-3 py-2 bg-[var(--bg-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] text-sm text-[var(--text-tertiary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] transition-all"
        >
          + 文件夹
        </button>
      </div>
    </header>
  );
}

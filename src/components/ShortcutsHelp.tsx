import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Eye,
  Keyboard,
  MousePointer2,
  Navigation,
  Search,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useAppStore } from "../stores/appStore";

interface ShortcutItem {
  /** 键位文案；数组时渲染为并列的多个 key chip（如 F3 / / / Ctrl+F 三个等价键） */
  keys: string | string[];
  action: string;
}

const GROUPS: { title: string; icon: LucideIcon; note?: string; items: ShortcutItem[] }[] = [
  {
    title: "导航",
    icon: Navigation,
    items: [
      { keys: ["F3", "/", "Ctrl+F"], action: "聚焦搜索" },
      { keys: "Ctrl+K", action: "命令面板" },
      { keys: "↑ ↓", action: "移动选中项（网格按列）" },
      { keys: "Home / End", action: "跳到首项 / 末项" },
      { keys: "PageUp / PageDown", action: "翻页选择" },
      { keys: "Enter", action: "打开选中项" },
      { keys: "Space", action: "快速预览" },
      { keys: "Esc", action: "关闭浮层 / 清空搜索" },
    ],
  },
  {
    title: "选择与整理",
    icon: MousePointer2,
    items: [
      { keys: "Ctrl+A", action: "全选当前结果" },
      { keys: "单击 / Ctrl / Shift+单击", action: "选择 / 加选 / 范围" },
      { keys: "拖拽框选 / Alt+拖拽", action: "框选 / 减选框内项" },
      { keys: "右键已选标签 / 侧栏 Alt+单击", action: "排除 / 取消排除该标签" },
      { keys: "Shift + 方向键", action: "范围选择" },
      { keys: "Shift+F10 / 菜单键", action: "打开选中项菜单" },
      { keys: "Delete", action: "仅出库（可改删本地文件）" },
      { keys: "Ctrl+C", action: "复制选中路径（多项换行）" },
      { keys: "Ctrl+D", action: "收藏 / 取消收藏" },
      { keys: "G / I / L", action: "网格 / 大图标 / 列表" },
    ],
  },
  {
    title: "快速预览（预览打开时）",
    icon: Eye,
    note: "预览打开时 Ctrl+A 不生效，避免误全选背景列表。",
    items: [
      { keys: "Space", action: "关闭预览" },
      { keys: "↑ ↓ ← → / Home / End", action: "切换预览项目" },
      { keys: "Enter", action: "打开预览项目" },
      { keys: "Ctrl+C", action: "复制预览项目路径" },
      { keys: "Ctrl+D", action: "收藏 / 取消收藏预览项目" },
    ],
  },
  {
    title: "其它",
    icon: Settings2,
    items: [
      { keys: "Ctrl+,", action: "打开设置" },
      { keys: "?", action: "本快捷键一览" },
    ],
  },
];

function itemMatches(item: ShortcutItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const keys = Array.isArray(item.keys) ? item.keys : [item.keys];
  return item.action.toLowerCase().includes(needle) || keys.some((key) => key.toLowerCase().includes(needle));
}

export function ShortcutsHelp() {
  const open = useAppStore((state) => state.shortcutsHelpOpen);
  const setOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const [query, setQuery] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // 输入框有内容时 Esc 先清空；空时再关帮助。走同一条 useEscapeKey 栈，不另挂监听。
  useEscapeKey(() => {
    if (query) {
      setQuery("");
      return;
    }
    setOpen(false);
  }, open);

  if (!open) return null;

  const visibleGroups = GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => itemMatches(item, query)) }))
    .filter((group) => group.items.length > 0);

  return createPortal(
    <div
      data-shortcuts-help=""
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center px-3 py-5 sm:px-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-shortcuts-help)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        className="modal-surface flex max-h-[88dvh] w-[620px] max-w-[calc(100vw-24px)] flex-col overflow-hidden"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line-hairline)] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <Keyboard aria-hidden="true" size={17} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h2 id="shortcuts-help-title" className="text-base font-semibold leading-5 text-[var(--text-primary)]">
                键盘快捷键
              </h2>
              <p className="text-[12px] leading-4 text-[var(--text-faint)]">速查表</p>
            </div>
          </div>
          <div className="input-frame flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5">
            <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.8} />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜快捷键或动作"
              aria-label="搜索快捷键"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] outline-none"
            />
          </div>
          <button
            type="button"
            className="icon-button shrink-0"
            onClick={() => setOpen(false)}
            title="关闭快捷键帮助"
            aria-label="关闭快捷键帮助"
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
          {visibleGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">没有匹配的快捷键</p>
          ) : (
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {visibleGroups.map((group, groupIndex) => {
                const Icon = group.icon;
                return (
                  <section key={group.title} className={groupIndex === visibleGroups.length - 1 ? "sm:col-span-2" : undefined}>
                    <div className="flex items-center gap-1.5 border-b border-[var(--line-hairline)] pb-1">
                      <Icon aria-hidden="true" size={14} strokeWidth={1.8} className="text-[var(--accent-primary)]" />
                      <h3 className="instrument-label text-[var(--text-secondary)]">{group.title}</h3>
                      <span className="data-readout ml-auto text-[12px] text-[var(--text-faint)]">
                        {String(group.items.length).padStart(2, "0")}
                      </span>
                    </div>
                    <ul className={groupIndex === visibleGroups.length - 1 ? "grid sm:grid-cols-2 sm:gap-x-6" : undefined}>
                      {group.items.map((item) => {
                        const chips = Array.isArray(item.keys) ? item.keys : [item.keys];
                        return (
                          <li
                            key={item.action}
                            className="flex min-h-7 items-center justify-between gap-3 border-b border-[var(--line-hairline)] py-1 text-sm leading-4 last:border-b-0"
                          >
                            <span className="min-w-0 text-[var(--text-secondary)]">{item.action}</span>
                            <span className="flex max-w-[58%] shrink-0 flex-wrap justify-end gap-1">
                              {chips.map((chip) => (
                                <kbd key={chip} className="kbd whitespace-normal py-0.5 text-right leading-4">
                                  {chip}
                                </kbd>
                              ))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {group.note && (
                      <p className="mt-1.5 text-xs leading-4 text-[var(--text-faint)]">{group.note}</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-2.5 sm:px-5">
          <span className="text-xs text-[var(--text-faint)]">
            按 <kbd className="kbd mx-1">Esc</kbd> 关闭
          </span>
          <button type="button" onClick={() => setOpen(false)} className="action-button action-button-primary">
            <Check aria-hidden="true" size={16} strokeWidth={1.9} />
            关闭
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

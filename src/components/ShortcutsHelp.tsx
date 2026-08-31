import { createPortal } from "react-dom";
import {
  Check,
  Keyboard,
  MousePointer2,
  Navigation,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useAppStore } from "../stores/appStore";

const GROUPS: { title: string; icon: LucideIcon; items: { keys: string; action: string }[] }[] = [
  {
    title: "导航",
    icon: Navigation,
    items: [
      { keys: "/ 或 Ctrl+F", action: "聚焦搜索" },
      { keys: "Ctrl+K", action: "命令面板" },
      { keys: "↑ ↓", action: "移动选中项（网格按列）" },
      { keys: "Home / End", action: "跳到首项 / 末项" },
      { keys: "PageUp / PageDown", action: "翻页选择" },
      { keys: "Enter", action: "启动选中项" },
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
      { keys: "Shift + 方向键", action: "范围选择" },
      { keys: "Shift+F10 / 菜单键", action: "打开选中项菜单" },
      { keys: "Delete", action: "从应用移除" },
      { keys: "Ctrl+C", action: "复制选中路径（多项换行）" },
      { keys: "Ctrl+D", action: "收藏 / 取消收藏" },
      { keys: "G / L", action: "网格 / 列表" },
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

export function ShortcutsHelp() {
  const open = useAppStore((state) => state.shortcutsHelpOpen);
  const setOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(() => setOpen(false), open);
  if (!open) return null;

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
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--line-hairline)] px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <Keyboard aria-hidden="true" size={19} strokeWidth={1.8} />
            </div>
            <div>
              <div className="instrument-label">Reference / Keyboard</div>
              <h2 id="shortcuts-help-title" className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                键盘快捷键
              </h2>
            </div>
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {GROUPS.map((group, groupIndex) => {
              const Icon = group.icon;
              return (
                <section key={group.title} className={groupIndex === GROUPS.length - 1 ? "sm:col-span-2" : undefined}>
                  <div className="flex items-center gap-2 border-b border-[var(--line-hairline)] pb-2">
                    <Icon aria-hidden="true" size={15} strokeWidth={1.8} className="text-[var(--accent-primary)]" />
                    <h3 className="instrument-label text-[var(--text-secondary)]">{group.title}</h3>
                    <span className="data-readout ml-auto text-[10px] text-[var(--text-faint)]">
                      {String(group.items.length).padStart(2, "0")}
                    </span>
                  </div>
                  <ul className={groupIndex === GROUPS.length - 1 ? "grid sm:grid-cols-2 sm:gap-x-6" : undefined}>
                    {group.items.map((item) => (
                      <li
                        key={item.keys}
                        className="flex min-h-9 items-center justify-between gap-3 border-b border-[var(--line-hairline)] py-1.5 text-sm last:border-b-0"
                      >
                        <span className="min-w-0 text-[var(--text-secondary)]">{item.action}</span>
                        <kbd className="kbd max-w-[58%] shrink-0 justify-end whitespace-normal py-1 text-right leading-4">
                          {item.keys}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-3 sm:px-5">
          <span className="text-xs text-[var(--text-faint)]">
            按 <kbd className="kbd mx-1">Esc</kbd> 关闭
          </span>
          <button type="button" onClick={() => setOpen(false)} className="action-button action-button-primary">
            <Check aria-hidden="true" size={16} strokeWidth={1.9} />
            完成
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

import { createPortal } from "react-dom";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useAppStore } from "../stores/appStore";

const GROUPS: { title: string; items: { keys: string; action: string }[] }[] = [
  {
    title: "导航",
    items: [
      { keys: "/ 或 Ctrl+F", action: "聚焦搜索" },
      { keys: "Ctrl+K", action: "命令面板" },
      { keys: "↑ ↓", action: "移动选中项" },
      { keys: "Enter", action: "启动选中项" },
      { keys: "Space", action: "快速预览" },
      { keys: "Esc", action: "关闭浮层 / 清空搜索" },
    ],
  },
  {
    title: "选择与整理",
    items: [
      { keys: "Ctrl+A", action: "全选当前结果" },
      { keys: "Delete", action: "从应用移除" },
      { keys: "Ctrl+C", action: "复制路径" },
      { keys: "G / L", action: "网格 / 列表" },
    ],
  },
  {
    title: "其它",
    items: [
      { keys: "Ctrl+,", action: "打开设置" },
      { keys: "?", action: "本快捷键一览" },
    ],
  },
];

export function ShortcutsHelp() {
  const open = useAppStore((state) => state.shortcutsHelpOpen);
  const setOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  useEscapeKey(() => setOpen(false), open);
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_62%,transparent)] px-4"
      style={{ zIndex: "var(--z-shortcuts-help)" as unknown as number }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="modal-surface w-full max-w-[560px] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">键盘快捷键</h3>
          <button type="button" className="icon-button" onClick={() => setOpen(false)} title="关闭">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                {group.title}
              </h4>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.keys} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--text-secondary)]">{item.action}</span>
                    <kbd className="kbd shrink-0">{item.keys}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

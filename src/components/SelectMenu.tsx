// ============================================================================
// components/SelectMenu.tsx — 主题化下拉选择器（替代原生 <select>）
// ----------------------------------------------------------------------------
// 原生 select 的弹层由操作系统渲染，配色与主题脱节、字体也不随应用字号。
// 本组件提供与应用同一令牌体系的列表弹层：
// - 支持扁平 options 或分组 groups（组头不可选）；
// - 键盘可达：Enter/Space/ArrowDown 展开，↑↓ 移动，Enter 选定，Esc 关闭；
// - 点击外部 / 选择后自动关闭；弹层宽度跟随按钮，内容更宽时自动加宽。
// ============================================================================

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectMenuOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectMenuGroup {
  label: string;
  options: SelectMenuOption[];
}

interface SelectMenuProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /** 扁平选项（与 groups 二选一） */
  options?: SelectMenuOption[];
  /** 分组选项（与 options 二选一） */
  groups?: SelectMenuGroup[];
  /** 触发按钮的 className（高度/内边距/字号由调用方决定） */
  className?: string;
  disabled?: boolean;
}

export function SelectMenu({ value, onChange, ariaLabel, options, groups, className, disabled }: SelectMenuProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const flat: SelectMenuOption[] = groups ? groups.flatMap((group) => group.options) : (options ?? []);
  const current = flat.find((option) => option.value === value);

  // 点击组件外部即关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // 展开时把高亮定位到当前值，并滚动到可见区域
  useEffect(() => {
    if (!open) return;
    const index = flat.findIndex((option) => option.value === value);
    setActiveIndex(index);
    if (index >= 0) {
      // jsdom 等环境没有 scrollIntoView，可选调用
      document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + flat.length) % Math.max(1, flat.length));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = flat[activeIndex];
      if (option) pick(option.value);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  let optionIndex = -1;

  return (
    <div ref={rootRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={className}
      >
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-faint)] transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-[var(--z-context-menu)] mt-1 max-h-72 min-w-full w-max max-w-72 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-overlay)]"
        >
          {(groups ?? [{ label: "", options: options ?? [] }]).map((group) => (
            <div key={group.label || "__flat__"}>
              {group.label && (
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--text-faint)]">
                  {group.label}
                </div>
              )}
              {group.options.map((option) => {
                optionIndex += 1;
                const index = optionIndex;
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    title={option.hint}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pick(option.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                      index === activeIndex ? "bg-[var(--bg-hover)]" : ""
                    } ${selected ? "font-semibold text-[var(--accent-primary)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

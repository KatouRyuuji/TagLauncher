// ============================================================================
// components/SelectMenu.tsx — 主题化下拉选择器（替代原生 <select>）
// ----------------------------------------------------------------------------
// 原生 select 的弹层由操作系统渲染，配色与主题脱节、字体也不随应用字号。
// 本组件提供与应用同一令牌体系的列表弹层：
// - 支持扁平 options 或分组 groups（组头不可选）；
// - 键盘可达：Enter/Space/ArrowDown 展开，↑↓ 移动，Enter 选定，Esc 关闭；
// - 点击外部 / 选择后自动关闭；
// - 弹层 portal 到 body，避免被 overflow 父级裁切；
// - 选中行走实心主色（RyuujiDesign 菜单配方），与芯片/列表选中一致。
// ============================================================================

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectMenuOption {
  value: string;
  label: string;
  hint?: string;
  /** 选项代表色（CSS 颜色，如主题 accent）：有值时在触发按钮与选项左侧渲染色点 */
  swatch?: string;
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

interface MenuPos {
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
}

export function SelectMenu({ value, onChange, ariaLabel, options, groups, className, disabled }: SelectMenuProps) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  const flat: SelectMenuOption[] = groups ? groups.flatMap((group) => group.options) : (options ?? []);
  const current = flat.find((option) => option.value === value);

  const updateMenuPos = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const gutter = 8;
    const desired = 288;
    const spaceBelow = window.innerHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const flip = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(desired, flip ? spaceAbove : spaceBelow));
    setMenuPos({
      top: flip ? Math.max(gutter, rect.top - maxHeight - 4) : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 160) - gutter),
      minWidth: rect.width,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    window.addEventListener("resize", updateMenuPos);
    return () => window.removeEventListener("resize", updateMenuPos);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = flat.findIndex((option) => option.value === value);
    setActiveIndex(index);
    if (index >= 0) {
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
    <div className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={className}
      >
        {current?.swatch && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--line-hairline)]"
            style={{ backgroundColor: current.swatch }}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-faint)] transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>

      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              style={{
                position: "fixed",
                top: menuPos.top,
                left: menuPos.left,
                minWidth: menuPos.minWidth,
                maxHeight: menuPos.maxHeight,
                zIndex: "var(--z-select-menu)",
              }}
              className="w-max max-w-80 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-overlay)]"
            >
              {(groups ?? [{ label: "", options: options ?? [] }]).map((group) => (
                <div key={group.label || "__flat__"}>
                  {group.label && (
                    <div className="px-3 pb-1 pt-2 text-[13px] font-semibold text-[var(--text-faint)]">
                      {group.label}
                    </div>
                  )}
                  {group.options.map((option) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    const selected = option.value === value;
                    const active = index === activeIndex;
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
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] ${
                          selected
                            ? "bg-[var(--accent-primary)] font-semibold text-[var(--text-invert)]"
                            : active
                              ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {option.swatch && (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--line-hairline)]"
                            style={{ backgroundColor: option.swatch }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

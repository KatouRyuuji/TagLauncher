import { useEffect, useRef } from "react";

// ============================================================================
// hooks/useFocusTrap.ts — 浮层焦点陷阱
// ============================================================================
// 为弹层/菜单/对话框提供无障碍键盘支持：
//   - 激活时自动聚焦到容器内第一个可聚焦元素（或调用方指定的元素）
//   - Tab / Shift+Tab 限制在容器内循环，焦点不会逃逸到页面其他区域
//   - 失活时把焦点恢复到触发源（调用方传入 restoreFocus 元素）
// 配合 useEscapeKey 使用即可同时支持 Escape 关闭。
// ============================================================================

const FOCUSABLE_SELECTOR = [
  "button",
  "[href]",
  "input",
  "select",
  "textarea",
  "[tabindex]",
].join(", ");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]') || element.closest("[hidden], [inert]")) return false;
    if (getComputedStyle(element).visibility !== "visible") return false;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).display === "none") return false;
    }
    return true;
  });
}

interface UseFocusTrapOptions {
  active: boolean;
  /** 失活时恢复焦点的元素；默认为 document.activeElement */
  restoreFocus?: HTMLElement | null;
  /** 是否自动聚焦到第一个可聚焦元素；默认 true */
  autoFocus?: boolean;
}

export function useFocusTrap<T extends HTMLElement>(options: UseFocusTrapOptions) {
  const containerRef = useRef<T>(null);
  const previousActiveRef = useRef<Element | null>(null);
  // 激活时刻的 restoreFocus 快照：只取激活时一次的值，不随调用方引用变化重跑
  // effect——否则重跑会重新捕获 document.activeElement（此刻焦点可能已在陷阱内），
  // 失活后焦点被恢复到陷阱内部元素。
  const restoreSnapshotRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!options.active) return;
    previousActiveRef.current = document.activeElement;
    restoreSnapshotRef.current = options.restoreFocus ?? null;

    const container = containerRef.current;
    if (!container) return;

    const focusables = focusableElements(container);
    const previousTabIndex = container.getAttribute("tabindex");
    if (previousTabIndex === null) container.tabIndex = -1;

    if (options.autoFocus !== false) {
      const autofocusEl = focusables.find((element) => element.hasAttribute("autofocus"));
      (autofocusEl ?? focusables[0] ?? container).focus();
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const currentFocusables = focusableElements(container);
      if (currentFocusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      const activeIsFocusable = currentFocusables.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (document.activeElement === first || !activeIsFocusable)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeIsFocusable)) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handler);
    return () => {
      container.removeEventListener("keydown", handler);
      if (previousTabIndex === null) container.removeAttribute("tabindex");
      const restoreTo = restoreSnapshotRef.current ?? previousActiveRef.current;
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus();
      }
    };
    // options.restoreFocus 有意不入依赖：只在激活时刻取快照（见上注释）
  }, [options.active, options.autoFocus]);

  return containerRef;
}

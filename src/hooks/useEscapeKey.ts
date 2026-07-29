import { useEffect } from "react";

/**
 * 浮层/弹窗的 Escape 关闭支持（栈式管理）。
 *
 * 所有通过本 hook 注册的浮层进入一个全局栈：后注册的位于栈顶。
 * 按 Escape 时仅栈顶浮层响应并关闭，下层浮层保持打开，
 * 避免堆叠场景（如设置页 + AI 打标弹窗）一次 Esc 全部关闭。
 */
const escapeStack: Array<() => void> = [];

export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    escapeStack.push(onEscape);
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeStack[escapeStack.length - 1] === onEscape) {
        event.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      const index = escapeStack.lastIndexOf(onEscape);
      if (index >= 0) escapeStack.splice(index, 1);
    };
  }, [onEscape, active]);
}

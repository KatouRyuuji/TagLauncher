import { useEffect, useRef } from "react";

/**
 * 浮层/弹窗的 Escape 关闭支持（栈式管理）。
 *
 * 所有通过本 hook 注册的浮层进入一个全局栈：后注册的位于栈顶。
 * 按 Escape 时仅栈顶浮层响应并关闭，下层浮层保持打开，
 * 避免堆叠场景（如设置页 + AI 打标弹窗）一次 Esc 全部关闭。
 */
const escapeStack: Array<() => void> = [];

export function useEscapeKey(onEscape: () => void, active = true): void {
  // ref 持有最新回调：调用方常传内联函数，若直接订阅会导致每次渲染重订阅；
  // 订阅只随 active 变化，栈内保存稳定包装，回调本体经 ref 取最新。
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const entry = () => onEscapeRef.current();
    escapeStack.push(entry);
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeStack[escapeStack.length - 1] === entry) {
        event.stopPropagation();
        entry();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      const index = escapeStack.lastIndexOf(entry);
      if (index >= 0) escapeStack.splice(index, 1);
    };
  }, [active]);
}

import { useEffect } from "react";

/**
 * 浮层/弹窗的 Escape 关闭支持。
 * 在捕获阶段监听 Escape，触发时调用 onEscape 并阻止冒泡，避免穿透到下层浮层。
 */
export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onEscape, active]);
}

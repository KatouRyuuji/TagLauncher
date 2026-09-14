import { useEffect } from "react";

/** 指针描边仅在支持悬停的仪表主题中启用，每帧合并一次布局读取与坐标写入。 */
export function useCardPointerHighlight() {
  useEffect(() => {
    const root = document.documentElement;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hover = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame: number | null = null;
    let pending: PointerEvent | null = null;
    let listening = false;

    const cancelPending = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };

    const paint = () => {
      frame = null;
      const event = pending;
      pending = null;
      const target = event?.target instanceof Element
        ? event.target.closest<HTMLElement>(".item-card-render-scope")
        : null;
      if (!event || !target?.isConnected) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--reveal-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--reveal-y", `${event.clientY - rect.top}px`);
    };

    const onMove = (event: PointerEvent) => {
      pending = event;
      if (frame === null) frame = requestAnimationFrame(paint);
    };

    const sync = () => {
      const enabled = root.dataset.shape === "b" && !motion.matches && hover.matches;
      if (enabled === listening) return;
      listening = enabled;
      if (enabled) window.addEventListener("pointermove", onMove, { passive: true });
      else {
        window.removeEventListener("pointermove", onMove);
        cancelPending();
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-shape"] });
    motion.addEventListener("change", sync);
    hover.addEventListener("change", sync);
    sync();
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", sync);
      hover.removeEventListener("change", sync);
      window.removeEventListener("pointermove", onMove);
      cancelPending();
    };
  }, []);
}

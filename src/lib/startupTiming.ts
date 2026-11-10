/**
 * 启动计时：首个对象卡片/行出现在 DOM 后的下一帧打 performance.mark。
 * 与 performance.timeOrigin 相加即首屏对象出现的墙钟时刻，E2E 冷启动 TTI 以此为终点
 * （起点是进程创建），不受测试框架连接调试端口的等待影响。只观察、不改任何渲染行为。
 */
export const FIRST_ITEMS_MARK = "tl:first-items";
const ITEM_SELECTOR = "[data-selectable-item-id]";
/** 空库永远等不到对象：超时后停止观察，避免长期挂着 MutationObserver */
const OBSERVE_LIMIT_MS = 60_000;

export function observeFirstItemPaint(doc: Document = document): () => void {
  if (typeof MutationObserver === "undefined" || typeof performance === "undefined" || typeof performance.mark !== "function") {
    return () => {};
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    const mark = () => performance.mark(FIRST_ITEMS_MARK);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(mark);
    else mark();
  };
  const observer = new MutationObserver(() => {
    if (doc.querySelector(ITEM_SELECTOR)) finish();
  });
  const timer = window.setTimeout(() => {
    done = true;
    observer.disconnect();
  }, OBSERVE_LIMIT_MS);
  if (doc.querySelector(ITEM_SELECTOR)) finish();
  else observer.observe(doc.documentElement, { childList: true, subtree: true });
  return () => {
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

import { useLayoutEffect, useState, type RefObject } from "react";

// 分页视图中尚未取到数据的位置：按已加载行的实际高度占住版面，取到后替换为真实卡片/行。
// data-item-placeholder 供 E2E 判断可视区是否已填满。
export function ItemPlaceholder({ height }: { height: number }) {
  return (
    <div
      data-item-placeholder=""
      aria-hidden="true"
      style={{ height }}
      className="animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-hover,rgba(127,127,127,0.08))]"
    />
  );
}

/**
 * 占位行高 = 最近一个已加载行的真实高度（无则用估计值）。占位与真实行等高，页到达时行高不变：
 * 否则行高骤变会让虚拟器在 ResizeObserver 回调里挂载新行（RO loop 告警）并让下方内容跳动。
 * 每次提交后读一次 DOM（虚拟化下只有十几行）。
 */
export function useLoadedRowHeight(containerRef: RefObject<HTMLElement | null>, fallback: number): number {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    for (const row of root.querySelectorAll<HTMLElement>("[data-index]")) {
      if (row.querySelector("[data-item-placeholder]")) continue;
      const h = row.offsetHeight;
      if (h > 0 && h !== height) setHeight(h);
      return;
    }
  });
  return height ?? fallback;
}

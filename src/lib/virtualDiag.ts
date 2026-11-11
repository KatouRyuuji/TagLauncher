// lib/virtualDiag.ts — 虚拟列表现场快照（E2E 经 window.__tlMainPerf.stats.{list,grid}Virtual() 读取，F19）
//
// 只在被调用时读取：虚拟器认为的每个可见行（index / key / start / size）、该 key 的测量缓存、
// DOM 里同 data-index 行的真实高度与位置、该 DOM 节点是否就是虚拟器登记并观察尺寸的那个节点。
// 「缓存尺寸 ≠ DOM 尺寸」且长期不收敛，就是视口空带/重叠的直接证据。常驻开销为零。
import type { Virtualizer } from "@tanstack/react-virtual";
import { registerPerfStats } from "./mainPerf";

export interface VirtualDiagRow {
  i: number;
  key: string;
  start: number;
  size: number;
  cached: number | null;
  dom: number | null;
  domOffsetTop: number | null;
  observed: boolean;
}

export function virtualSnapshot<E extends Element>(v: Virtualizer<HTMLDivElement, E>, root: HTMLElement | null) {
  const items: VirtualDiagRow[] = v.getVirtualItems().map((it) => {
    const node = root?.querySelector<HTMLElement>(`[data-index="${it.index}"]`) ?? null;
    return {
      i: it.index,
      key: String(it.key),
      start: it.start,
      size: it.size,
      cached: v.itemSizeCache.get(it.key) ?? null,
      dom: node ? Math.round(node.getBoundingClientRect().height) : null,
      domOffsetTop: node ? node.offsetTop : null,
      observed: Boolean(node) && (v.elementsCache.get(it.key) as Element | undefined) === node,
    };
  });
  return {
    count: v.options.count,
    scrollOffset: v.scrollOffset,
    scrollTop: root?.scrollTop ?? null,
    isScrolling: v.isScrolling,
    totalSize: v.getTotalSize(),
    items,
  };
}

export function registerVirtualDiag<E extends Element>(
  name: "listVirtual" | "gridVirtual",
  v: Virtualizer<HTMLDivElement, E>,
  root: () => HTMLElement | null,
) {
  registerPerfStats(name, () => virtualSnapshot(v, root()));
}

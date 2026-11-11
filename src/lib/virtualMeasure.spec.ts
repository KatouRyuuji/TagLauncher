// F19 回归：估算随可见内容变化时，已测但「实测 = 当时估算」的行不得被按新估算重新定位。
// 直接驱动 virtual-core 状态机（与 ItemListView/ItemGrid 同版本），步骤对应 E2E F19-MATRIX
// 「列表视图: 滚动中搜索缩到 10 项」的现场快照：行 2–7 实测 64、cached=null、size=75（估算）。
import { describe, expect, it } from "vitest";
import { Virtualizer, measureElement as defaultMeasure, type VirtualizerOptions } from "@tanstack/virtual-core";
import { createMeasuredSizes } from "./virtualMeasure";

const TALL = 75; // 带标签换行的行
const SHORT = 64;

function setup(fixed: boolean) {
  const scrollEl = document.createElement("div");
  document.body.append(scrollEl);
  let ids = Array.from({ length: 20 }, (_, i) => i + 1);
  // 首个已加载行的真实高度（useLoadedRowHeight 的语义）：初始首行是矮行
  let loadedRowHeight = SHORT;
  const measured = createMeasuredSizes();
  const heights = new Map<number, number>(ids.map((id) => [id, id % 7 === 1 ? TALL : SHORT]));
  const opts = (): VirtualizerOptions<HTMLDivElement, HTMLDivElement> => {
    const getItemKey = (i: number) => ids[i] ?? i;
    return {
      count: ids.length,
      getScrollElement: () => scrollEl,
      getItemKey,
      estimateSize: fixed ? (i) => measured.estimate(getItemKey(i), loadedRowHeight) : () => loadedRowHeight,
      measureElement: fixed ? measured.wrap(defaultMeasure) : defaultMeasure,
      scrollToFn: () => {},
      observeElementRect: (_inst, cb) => {
        cb({ width: 800, height: 2000 });
        return () => {};
      },
      observeElementOffset: (_inst, cb) => {
        cb(0, false);
        return () => {};
      },
      overscan: 0,
    };
  };
  const v = new Virtualizer(opts());
  v._didMount();
  v._willUpdate();
  const rowNode = (index: number) => {
    const node = document.createElement("div");
    node.dataset.index = String(index);
    const h = heights.get(ids[index])!;
    Object.defineProperty(node, "offsetHeight", { value: h });
    scrollEl.append(node);
    return node;
  };
  /** React 提交：每个渲染行挂载时 ref 回调 measureElement */
  const mount = (indexes: number[]) => indexes.forEach((i) => v.measureElement(rowNode(i)));
  /** 渲染：把最新选项交给虚拟器并取可见行（useVirtualizer 每次渲染都这么做） */
  const render = () => {
    v.setOptions(opts());
    return v.getVirtualItems();
  };
  return {
    v,
    render,
    mount,
    setIds: (next: number[]) => (ids = next),
    setLoadedRowHeight: (h: number) => (loadedRowHeight = h),
    heightOf: (index: number) => heights.get(ids[index])!,
  };
}

/** 相邻已渲染行：下一行起点 − 本行起点 必须等于本行真实 DOM 高度（否则空带/重叠） */
function layoutErrors(s: ReturnType<typeof setup>, count: number) {
  const items = s.render();
  const errs: string[] = [];
  for (let k = 0; k + 1 < Math.min(count, items.length); k++) {
    const gap = items[k + 1].start - items[k].start - s.heightOf(items[k].index);
    if (gap !== 0) errs.push(`row ${items[k].index}: ${gap > 0 ? "空带" : "重叠"} ${gap}px`);
  }
  return errs;
}

function scenario(s: ReturnType<typeof setup>) {
  // 1) 以矮行为首的一页：行实测 64 = 估算 64，resizeItem 判 delta=0，不写 itemSizeCache
  s.setIds(Array.from({ length: 20 }, (_, i) => i + 2)); // 首行 id 2（矮）
  s.render();
  s.mount([0, 1, 2, 3, 4, 5]);
  // 2) 搜索缩到 10 项：首行换成高行（id 1，75），useLoadedRowHeight 把估算改为 75
  s.setIds(Array.from({ length: 10 }, (_, i) => i + 1));
  s.render();
  s.mount([0]);
  s.setLoadedRowHeight(TALL);
  // 3) 行 1..6 的 DOM 节点（同 key 复用）不会重挂载、尺寸也没变 → 不会再被测量
}

describe("F19 虚拟列表：估算变化后已测行的定位", () => {
  it("复现：原配置下实测 = 旧估算的行被按新估算定位，出现 11px 空带", () => {
    const s = setup(false);
    scenario(s);
    const errs = layoutErrors(s, 7);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/空带 11px/);
  });

  it("修复：estimateSize 对测过的 key 返回实测值，相邻行无空带/重叠", () => {
    const s = setup(true);
    scenario(s);
    expect(layoutErrors(s, 7)).toEqual([]);
  });

  it("修复后未测过的行仍按回退估算（不影响占位/总高的估计）", () => {
    const s = setup(true);
    scenario(s);
    const items = s.v.getMeasurements();
    expect(items[9].size).toBe(TALL); // id 10 从未测过
  });
});

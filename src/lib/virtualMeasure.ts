// lib/virtualMeasure.ts — 已测行高登记（F19 根因修复）
//
// 根因（E2E F19-MATRIX 现场快照 + virtualMeasure.test.ts 复现）：
// virtual-core 的 resizeItem 只在「实测 ≠ 当前估算」时才把尺寸写进 itemSizeCache。
// 列表/网格的 estimateSize 取「首个已加载行的真实高度」（useLoadedRowHeight），会随可见内容变化。
// 实测恰好等于当时估算的行因此从未入缓存；估算随后改变（如首行换成带标签的高行）后，
// 下一次重算测量表（搜索/增删/取页）这些行按新估算定位，而 DOM 高度没变、ResizeObserver 不再触发，
// 行与行之间出现空带（估算偏大）或重叠（估算偏小），并一直保持到下次该行尺寸变化。
//
// 修复：自己登记每次实测的尺寸，estimateSize 对测过的 key 返回实测值，只对没测过的 key 用回退估算。
// 「估算不与实测矛盾」与虚拟器内部缓存是否写入无关。
import type { Virtualizer } from "@tanstack/react-virtual";

type Key = string | number | bigint;

export interface MeasuredSizes {
  /** 测过的 key 返回实测值，否则返回回退估算 */
  estimate(key: Key, fallback: number): number;
  /** 包装 measureElement：实测值按该行当前 key 登记 */
  wrap<S extends Element, E extends Element>(
    measure: (el: E, entry: ResizeObserverEntry | undefined, instance: Virtualizer<S, E>) => number,
  ): (el: E, entry: ResizeObserverEntry | undefined, instance: Virtualizer<S, E>) => number;
  readonly size: number;
}

export function createMeasuredSizes(): MeasuredSizes {
  const sizes = new Map<Key, number>();
  return {
    estimate: (key, fallback) => sizes.get(key) ?? fallback,
    wrap: (measure) => (el, entry, instance) => {
      const size = measure(el, entry, instance);
      const index = instance.indexFromElement(el);
      if (index >= 0 && index < instance.options.count) sizes.set(instance.options.getItemKey(index), size);
      return size;
    },
    get size() {
      return sizes.size;
    },
  };
}


// ============================================================================
// hooks/useLoadedItems.ts — 按 ID 取一组对象（选中集、编辑目标等）
// ----------------------------------------------------------------------------
// 主窗只缓存可视页；选中集可能含未缓存的对象（如 Ctrl+A 全选后批量操作）。
// 全在缓存里时同步给出；否则向后端补取，数据代（dataEpoch）变化时重取。
// 返回值里已缓存的对象总用缓存里的（写入后就地更新的那份）。
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import type { ItemView } from "../lib/itemView";
import type { ItemWithTags } from "../types";

const EMPTY: ItemWithTags[] = [];

export function useLoadedItems(view: ItemView, ids: readonly number[], dataEpoch: number): ItemWithTags[] {
  return useLoadedItemsState(view, ids, dataEpoch).items;
}

/** 同上，另给出 settled：当前 ID 集合（与数据代）的结果是否已取回（区分「还在取」与「已不存在」）。 */
export function useLoadedItemsState(
  view: ItemView,
  ids: readonly number[],
  dataEpoch: number,
): { items: ItemWithTags[]; settled: boolean } {
  const sync = useMemo(() => {
    if (ids.length === 0) return EMPTY;
    const out: ItemWithTags[] = [];
    for (const id of ids) {
      const item = view.get(id);
      if (!item) return null;
      out.push(item);
    }
    return out;
  }, [view, ids]);
  const needLoad = sync === null;
  const [loaded, setLoaded] = useState<{ ids: readonly number[]; epoch: number; byId: Map<number, ItemWithTags> } | null>(null);

  useEffect(() => {
    if (!needLoad) return;
    let cancelled = false;
    void view
      .load(ids)
      .then((items) => {
        if (!cancelled) setLoaded({ ids, epoch: dataEpoch, byId: new Map(items.map((item) => [item.id, item] as const)) });
      })
      .catch((error: unknown) => console.error("取对象失败:", error));
    return () => {
      cancelled = true;
    };
    // view 每次缓存变化都换引用：只在 ID 集合或数据代变化时重取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needLoad, ids, dataEpoch]);

  return useMemo(() => {
    if (sync) return { items: sync, settled: true };
    if (!loaded) return { items: EMPTY, settled: false };
    const out: ItemWithTags[] = [];
    for (const id of ids) {
      const item = view.get(id) ?? loaded.byId.get(id);
      if (item) out.push(item);
    }
    return { items: out, settled: loaded.ids === ids && loaded.epoch === dataEpoch };
  }, [sync, loaded, ids, view, dataEpoch]);
}

/** 单个对象（编辑弹窗目标等）；id 为 null 时 undefined。 */
export function useLoadedItem(view: ItemView, id: number | null, dataEpoch: number): ItemWithTags | undefined {
  return useLoadedItemState(view, id, dataEpoch).item;
}

export function useLoadedItemState(
  view: ItemView,
  id: number | null,
  dataEpoch: number,
): { item: ItemWithTags | undefined; settled: boolean } {
  const ids = useMemo(() => (id === null ? [] : [id]), [id]);
  const { items, settled } = useLoadedItemsState(view, ids, dataEpoch);
  return { item: items[0], settled };
}

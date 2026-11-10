import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import type { ItemView } from "../lib/itemView";
import { markDataCommit, markFirstItems } from "../lib/mainPerf";

/**
 * 列表组件订阅页数据：取页到达时只重渲染列表本身（视图快照不变，工作台其余部分不动）。
 * 顺带记录首屏（首页对象数据提交后，见 mainPerf）。
 */
export function useViewData(view: ItemView): number {
  const version = useSyncExternalStore(view.subscribeData, view.dataVersion);
  useLayoutEffect(() => {
    if (version > 0) markDataCommit();
  }, [version]);
  useEffect(() => {
    if (view.ids.length > 0 && view.at(0)) markFirstItems(view.ids.length);
  }, [view, version]);
  return version;
}

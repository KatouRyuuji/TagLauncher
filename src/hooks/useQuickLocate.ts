// ============================================================================
// hooks/useQuickLocate.ts — 快速搜索窗「在主窗定位」的主窗侧处理
// ============================================================================
// 后端 quick_locate_in_main 显示主窗后发 `quick-locate { id }`。主窗清空筛选与搜索
// （目标可能被当前筛选挡住），等可见列表里出现该对象后选中并滚动到它。
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { requestSelectionScrollFollow } from "../components/SelectionCanvas";
import { showToast } from "../lib/toast";

export const QUICK_LOCATE_EVENT = "quick-locate";
/** 清空筛选后等目标出现在可见列表的最长时间 */
export const QUICK_LOCATE_TIMEOUT_MS = 3000;

export function useQuickLocate(
  items: ReadonlyArray<{ id: number }>,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const pending = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<{ id?: unknown }>(QUICK_LOCATE_EVENT, (event) => {
        const id = event.payload?.id;
        if (cancelled || typeof id !== "number") return;
        if (pending.current) clearTimeout(pending.current.timer);
        pending.current = {
          id,
          timer: setTimeout(() => {
            if (pending.current?.id !== id) return;
            pending.current = null;
            showToast("该对象在主窗口当前视图中不可见（可能是文件夹内的子项）", "info");
          }, QUICK_LOCATE_TIMEOUT_MS),
        };
        useAppStore.getState().clearWorkspaceFilters();
        setRequest((n) => n + 1);
      }))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    const target = pending.current;
    if (!target || !items.some((item) => item.id === target.id)) return;
    clearTimeout(target.timer);
    pending.current = null;
    requestSelectionScrollFollow(target.id);
    setSelectedItemIds([target.id]);
  }, [items, request, setSelectedItemIds]);
}

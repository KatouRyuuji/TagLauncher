import { useCallback, useEffect, useRef, useState } from "react";
import { applyContextSelection, applyPointerSelection } from "../lib/itemQuery";
import { getWorkspaceSelectionAnchor, setWorkspaceSelectionAnchor } from "../lib/workspaceChrome";
import { shouldSuppressInternalDragClick } from "../stores/internalDragStore";

interface SelectionCanvasProps {
  itemIds: number[];
  selectedItemIds: number[];
  onSelectItems: (itemIds: number[]) => void;
  children: React.ReactNode;
  className?: string;
  dataRegion?: string;
  /** 将滚动容器的 DOM 元素同步到此 ref，供虚拟化器（virtualizer）使用 */
  scrollElementRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * 返回每个 item 在滚动容器内容坐标系中的几何矩形。
   * 若提供，框选将基于这些逻辑坐标命中全部 item（包括虚拟化卸载的项），
   * 否则回退到 querySelectorAll 仅命中当前 DOM 中的项。
   */
  getItemRects?: () => Map<number, Rect>;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 距上/下边缘多少 px 内触发框选自动滚动 */
const EDGE_ZONE = 48;
/** 自动滚动每帧最大像素 */
const MAX_SCROLL_SPEED = 20;

function clientRectToContentRect(rect: Rect, container: HTMLElement): Rect {
  const containerRect = container.getBoundingClientRect();
  return {
    left: rect.left - containerRect.left + container.scrollLeft,
    top: rect.top - containerRect.top + container.scrollTop,
    right: rect.right - containerRect.left + container.scrollLeft,
    bottom: rect.bottom - containerRect.top + container.scrollTop,
  };
}

function rectsIntersect(a: Rect, b: Rect) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function getSelectionRect(startX: number, startY: number, currentX: number, currentY: number): Rect {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    right: Math.max(startX, currentX),
    bottom: Math.max(startY, currentY),
  };
}

function toSelectionBox(rect: Rect, container: HTMLElement): SelectionBox {
  const containerRect = container.getBoundingClientRect();
  return {
    left: rect.left - containerRect.left + container.scrollLeft,
    top: rect.top - containerRect.top + container.scrollTop,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

function shouldStartSelection(target: EventTarget, container: HTMLElement) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-selectable-item-id]")) return false;
  if (target.closest("button,a,input,select,textarea,[role='button'],[data-no-marquee-select]")) return false;
  return container.contains(target);
}

function sameNumberArray(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameIdSet(arr: number[], set: Set<number>) {
  if (arr.length !== set.size) return false;
  for (const id of arr) if (!set.has(id)) return false;
  return true;
}

export function SelectionCanvas({
  itemIds,
  selectedItemIds,
  onSelectItems,
  children,
  className,
  dataRegion,
  scrollElementRef,
  getItemRects,
}: SelectionCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    active: boolean;
    selected: Set<number>;
  } | null>(null);
  const selectedItemIdsRef = useRef(selectedItemIds);
  const itemIdsRef = useRef(itemIds);
  const prevItemIdsRef = useRef<number[] | null>(null);
  const onSelectItemsRef = useRef(onSelectItems);
  const autoScrollRafRef = useRef<number | null>(null);
  const ignoreClickRef = useRef(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  useEffect(() => {
    selectedItemIdsRef.current = selectedItemIds;
  }, [selectedItemIds]);

  useEffect(() => {
    itemIdsRef.current = itemIds;
  }, [itemIds]);

  useEffect(() => {
    onSelectItemsRef.current = onSelectItems;
  }, [onSelectItems]);

  // 仅在 itemIds 集合真正变化时清理失效选中项（首次挂载也会执行一次）；
  // 框选 move 回写 selectedItemIds 不应触发清理重算。
  useEffect(() => {
    if (prevItemIdsRef.current !== null && sameNumberArray(prevItemIdsRef.current, itemIds)) return;
    prevItemIdsRef.current = itemIds;

    const currentSelected = selectedItemIdsRef.current;
    const selected = new Set(currentSelected);
    const next = itemIds.filter((id) => selected.has(id));
    if (!sameNumberArray(next, currentSelected)) {
      onSelectItems(next);
    }
  }, [itemIds, onSelectItems]);

  const collectIntersectingItems = useCallback((selectionRect: Rect) => {
    const container = containerRef.current;
    if (!container) return [] as number[];

    // 优先使用调用方提供的逻辑坐标（虚拟化全量命中）
    if (getItemRects) {
      const contentRect = clientRectToContentRect(selectionRect, container);
      const result: number[] = [];
      for (const [id, rect] of getItemRects()) {
        if (rectsIntersect(contentRect, rect)) {
          result.push(id);
        }
      }
      return result;
    }

    // 兜底：仅命中当前 DOM 中已渲染的项
    return Array.from(container.querySelectorAll<HTMLElement>("[data-selectable-item-id]"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rectsIntersect(selectionRect, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        });
      })
      .map((node) => Number(node.dataset.selectableItemId))
      .filter((id) => Number.isFinite(id));
  }, [getItemRects]);

  // 用当前指针位置刷新选框与命中集合。命中项在单次拖拽内累积并集（union），
  // 使自动滚动经过的行即便随虚拟化卸载出 DOM，也不会从选中集丢失。
  const applySelectionAt = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;

    const selectionRect = getSelectionRect(drag.startX, drag.startY, clientX, clientY);
    setSelectionBox(toSelectionBox(selectionRect, container));

    for (const id of collectIntersectingItems(selectionRect)) {
      drag.selected.add(id);
    }
    if (!sameIdSet(selectedItemIdsRef.current, drag.selected)) {
      const next = Array.from(drag.selected);
      selectedItemIdsRef.current = next;
      onSelectItemsRef.current(next);
    }
  }, [collectIntersectingItems]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  // pointermove 高频触发（60-120Hz），每次全量构建命中 Map 太贵；
  // 用 rAF 合并：一帧内多次 move 只按最新坐标算一次。
  const selectionRafRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const scheduleApplySelectionAt = useCallback((clientX: number, clientY: number) => {
    pendingPointerRef.current = { x: clientX, y: clientY };
    if (selectionRafRef.current !== null) return;
    selectionRafRef.current = requestAnimationFrame(() => {
      selectionRafRef.current = null;
      const pending = pendingPointerRef.current;
      if (pending) applySelectionAt(pending.x, pending.y);
    });
  }, [applySelectionAt]);

  const cancelScheduledSelection = useCallback(() => {
    if (selectionRafRef.current !== null) {
      cancelAnimationFrame(selectionRafRef.current);
      selectionRafRef.current = null;
    }
    pendingPointerRef.current = null;
  }, []);

  // 自动滚动帧：按指针距边缘深度决定速度，滚动后用最新指针位置重算命中（并集累积）。
  const autoScrollStep = useCallback(() => {
    autoScrollRafRef.current = null;
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !drag.active || !container) return;

    const r = container.getBoundingClientRect();
    let vel = 0;
    if (drag.lastY < r.top + EDGE_ZONE) {
      const depth = Math.min(1, (r.top + EDGE_ZONE - drag.lastY) / EDGE_ZONE);
      vel = -Math.ceil(depth * MAX_SCROLL_SPEED);
    } else if (drag.lastY > r.bottom - EDGE_ZONE) {
      const depth = Math.min(1, (drag.lastY - (r.bottom - EDGE_ZONE)) / EDGE_ZONE);
      vel = Math.ceil(depth * MAX_SCROLL_SPEED);
    }
    if (vel === 0) return;

    const maxScroll = container.scrollHeight - container.clientHeight;
    const nextTop = Math.max(0, Math.min(maxScroll, container.scrollTop + vel));
    if (nextTop === container.scrollTop) return; // 已到顶/底

    container.scrollTop = nextTop;
    applySelectionAt(drag.lastX, drag.lastY);
    autoScrollRafRef.current = requestAnimationFrame(autoScrollStep);
  }, [applySelectionAt]);

  const maybeStartAutoScroll = useCallback(() => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container || autoScrollRafRef.current !== null) return;
    const r = container.getBoundingClientRect();
    if (drag.lastY < r.top + EDGE_ZONE || drag.lastY > r.bottom - EDGE_ZONE) {
      autoScrollRafRef.current = requestAnimationFrame(autoScrollStep);
    }
  }, [autoScrollStep]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!shouldStartSelection(event.target, event.currentTarget)) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
      selected: new Set<number>(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !container) return;

    const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
    if (!drag.active && moved < 6) return;
    drag.active = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    scheduleApplySelectionAt(event.clientX, event.clientY);
    maybeStartAutoScroll();
  };

  const endDrag = () => {
    stopAutoScroll();
    // 结算前先把排队的帧按最新坐标同步 flush，保证 pointerup 时刻选中集完整
    cancelScheduledSelection();
    const drag = dragRef.current;
    if (drag?.active) applySelectionAt(drag.lastX, drag.lastY);
    setSelectionBox(null);
    dragRef.current = null;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      if (selectedItemIdsRef.current.length > 0) {
        onSelectItemsRef.current([]);
      }
      setWorkspaceSelectionAnchor(null);
    } else {
      ignoreClickRef.current = true;
      const ordered = itemIdsRef.current.filter((id) => drag.selected.has(id));
      if (ordered.length > 0) setWorkspaceSelectionAnchor(ordered[0]);
    }

    endDrag();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    endDrag();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    // 内部拖拽（标签重排、拖到文件柜）结束后的残留 click 不应改选中。
    if (shouldSuppressInternalDragClick()) return;
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button,a,input,select,textarea,[role='button'],[data-item-drag],[data-tag-drag]")) return;
    const node = target.closest("[data-selectable-item-id]");
    if (!(node instanceof HTMLElement) || !event.currentTarget.contains(node)) return;
    const clickedId = Number(node.dataset.selectableItemId);
    if (!Number.isFinite(clickedId)) return;

    const result = applyPointerSelection(
      itemIdsRef.current,
      selectedItemIdsRef.current,
      clickedId,
      {
        shift: event.shiftKey,
        additive: event.ctrlKey || event.metaKey,
        anchorId: getWorkspaceSelectionAnchor(),
      },
    );
    setWorkspaceSelectionAnchor(result.anchorId);
    if (!sameNumberArray(result.ids, selectedItemIdsRef.current)) {
      selectedItemIdsRef.current = result.ids;
      onSelectItemsRef.current(result.ids);
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const node = target.closest("[data-selectable-item-id]");
    if (!(node instanceof HTMLElement) || !event.currentTarget.contains(node)) return;
    const targetId = Number(node.dataset.selectableItemId);
    if (!Number.isFinite(targetId)) return;

    const result = applyContextSelection(
      selectedItemIdsRef.current,
      targetId,
      getWorkspaceSelectionAnchor(),
    );
    setWorkspaceSelectionAnchor(result.anchorId);
    if (!sameNumberArray(result.ids, selectedItemIdsRef.current)) {
      selectedItemIdsRef.current = result.ids;
      onSelectItemsRef.current(result.ids);
    }
  };

  useEffect(() => () => {
    stopAutoScroll();
    cancelScheduledSelection();
  }, [stopAutoScroll, cancelScheduledSelection]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (scrollElementRef) (scrollElementRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      data-region={dataRegion}
      className={`relative ${className ?? ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {children}
      {selectionBox && (
        <div
          className="pointer-events-none absolute rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--accent-primary)_72%,transparent)] bg-[var(--accent-primary-bg-light)] shadow-[var(--shadow-glow)]"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
            zIndex: "var(--z-context-overlay)",
          }}
        />
      )}
    </div>
  );
}

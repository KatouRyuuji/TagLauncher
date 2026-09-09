import type { PointerEvent as ReactPointerEvent } from "react";
import {
  type InternalDragHoverTarget,
  type InternalDragPayload,
  useInternalDragStore,
} from "../stores/internalDragStore";

const DRAG_THRESHOLD = 6;
/** 距滚动容器上/下边缘多少 px 内触发拖拽自动滚动（与 SelectionCanvas 框选同口径） */
const EDGE_ZONE = 48;
/** 自动滚动每帧最大像素 */
const MAX_SCROLL_SPEED = 20;

/** 指针位置向上找最近的纵向可滚动祖先（拖拽落点滚动跟随用）。 */
function findScrollableAncestor(pointX: number, pointY: number): HTMLElement | null {
  let element = document.elementFromPoint(pointX, pointY);
  while (element) {
    if (element instanceof HTMLElement) {
      const overflowY = getComputedStyle(element).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight) {
        return element;
      }
    }
    element = element.parentElement;
  }
  return null;
}

interface BeginInternalPointerDragOptions {
  event: ReactPointerEvent<HTMLElement>;
  payload: InternalDragPayload;
  findHoverTarget: (event: PointerEvent) => InternalDragHoverTarget;
  onDrop: (target: InternalDragHoverTarget) => Promise<void> | void;
}

export function beginInternalPointerDrag({
  event,
  payload,
  findHoverTarget,
  onDrop,
}: BeginInternalPointerDragOptions): void {
  if (event.button !== 0) {
    return;
  }

  const pointerId = event.pointerId;
  const sourceElement = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  const previousUserSelect = document.body.style.userSelect;
  let activated = false;
  let finished = false;
  let rafId: number | null = null;
  let pendingMove: PointerEvent | null = null;
  // 最近一次指针位置：自动滚动/滚轮滚动导致内容位移后，按静止指针坐标重算悬停落点
  let lastMoveEvent: PointerEvent | null = null;
  let hoverRafId: number | null = null;
  let autoScrollRafId: number | null = null;

  const cleanup = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (hoverRafId !== null) {
      cancelAnimationFrame(hoverRafId);
      hoverRafId = null;
    }
    if (autoScrollRafId !== null) {
      cancelAnimationFrame(autoScrollRafId);
      autoScrollRafId = null;
    }
    pendingMove = null;
    lastMoveEvent = null;
    window.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("pointerup", handlePointerUp, true);
    window.removeEventListener("pointercancel", handlePointerCancel, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", handleScrollCapture, true);
    window.removeEventListener("blur", handleWindowBlur);
    if (sourceElement.hasPointerCapture?.(pointerId)) {
      sourceElement.releasePointerCapture?.(pointerId);
    }
    document.body.style.userSelect = previousUserSelect;
  };

  // 拖拽中每帧最多处理一次位置/落点更新，避免高刷屏下 elementFromPoint 与 store 写入过密
  const flushMove = () => {
    rafId = null;
    const moveEvent = pendingMove;
    pendingMove = null;
    if (!moveEvent || finished || !activated) {
      return;
    }
    lastMoveEvent = moveEvent;
    useInternalDragStore.getState().updateDrag(moveEvent.clientX, moveEvent.clientY);
    useInternalDragStore.getState().setHoverTarget(findHoverTarget(moveEvent));
    maybeStartAutoScroll(moveEvent);
  };

  // 自动滚动帧：按指针距容器边缘深度决定速度，滚动后用静止指针坐标重算落点。
  // 滚动容器按指针位置动态判定（对象列表/侧栏等任意可滚动区域都适用）。
  const autoScrollStep = () => {
    autoScrollRafId = null;
    const moveEvent = lastMoveEvent;
    if (finished || !activated || !moveEvent) return;

    const container = findScrollableAncestor(moveEvent.clientX, moveEvent.clientY);
    if (!container) return;

    const rect = container.getBoundingClientRect();
    let vel = 0;
    if (moveEvent.clientY < rect.top + EDGE_ZONE) {
      const depth = Math.min(1, (rect.top + EDGE_ZONE - moveEvent.clientY) / EDGE_ZONE);
      vel = -Math.ceil(depth * MAX_SCROLL_SPEED);
    } else if (moveEvent.clientY > rect.bottom - EDGE_ZONE) {
      const depth = Math.min(1, (moveEvent.clientY - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE);
      vel = Math.ceil(depth * MAX_SCROLL_SPEED);
    }
    if (vel === 0) return;

    const maxScroll = container.scrollHeight - container.clientHeight;
    const nextTop = Math.max(0, Math.min(maxScroll, container.scrollTop + vel));
    if (nextTop === container.scrollTop) return; // 已到顶/底

    container.scrollTop = nextTop;
    useInternalDragStore.getState().setHoverTarget(findHoverTarget(moveEvent));
    autoScrollRafId = requestAnimationFrame(autoScrollStep);
  };

  const maybeStartAutoScroll = (moveEvent: PointerEvent) => {
    if (autoScrollRafId !== null) return;
    const container = findScrollableAncestor(moveEvent.clientX, moveEvent.clientY);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (moveEvent.clientY < rect.top + EDGE_ZONE || moveEvent.clientY > rect.bottom - EDGE_ZONE) {
      autoScrollRafId = requestAnimationFrame(autoScrollStep);
    }
  };

  // 拖拽期间滚轮/触控板滚动不走 pointermove：监听滚动（捕获阶段覆盖任意容器），
  // 下一帧按静止指针坐标重算悬停落点，避免高亮与实际落点错位。
  const handleScrollCapture = () => {
    if (finished || !activated || !lastMoveEvent || hoverRafId !== null) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = null;
      if (finished || !activated || !lastMoveEvent) return;
      useInternalDragStore.getState().setHoverTarget(findHoverTarget(lastMoveEvent));
    });
  };

  const finish = async (target: InternalDragHoverTarget) => {
    if (finished) {
      return;
    }
    finished = true;

    if (activated) {
      const latestStore = useInternalDragStore.getState();
      latestStore.suppressClicks();
      latestStore.finishDrag();
    }

    cleanup();

    if (activated) {
      try {
        await onDrop(target);
      } catch (error) {
        console.error("Internal drag drop failed:", error);
      }
    }
  };

  const handlePointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId || finished) {
      return;
    }

    const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
    if (!activated && distance < DRAG_THRESHOLD) {
      return;
    }

    if (!activated) {
      // 激活帧立即处理，保证拖拽起始视觉与落点无延迟
      activated = true;
      lastMoveEvent = moveEvent;
      document.body.style.userSelect = "none";
      useInternalDragStore.getState().startDrag(payload, moveEvent.clientX, moveEvent.clientY);
      useInternalDragStore.getState().setHoverTarget(findHoverTarget(moveEvent));
      maybeStartAutoScroll(moveEvent);
    } else {
      // 后续移动合并到下一帧统一处理
      pendingMove = moveEvent;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushMove);
      }
    }
    moveEvent.preventDefault();
  };

  const handlePointerUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) {
      return;
    }

    const target = activated ? findHoverTarget(upEvent) : null;
    void finish(target);
  };

  const handlePointerCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) {
      return;
    }

    void finish(null);
  };

  const handleWindowBlur = () => {
    void finish(null);
  };

  // 拖拽期间 Esc 取消（不触发落点）。捕获阶段拦截并阻断传播，
  // 避免冒泡阶段的工作台热键把同一按键再解释为「清空选中」等动作。
  const handleKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== "Escape" || !activated || finished) return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    void finish(null);
  };

  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("pointercancel", handlePointerCancel, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("scroll", handleScrollCapture, true);
  window.addEventListener("blur", handleWindowBlur);
  sourceElement.setPointerCapture?.(pointerId);
  event.preventDefault();
  event.stopPropagation();
}

export function findClosestNumberDataAttribute(
  pointX: number,
  pointY: number,
  selector: string,
  attributeName: string,
): number | null {
  const element = document.elementFromPoint(pointX, pointY);
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const target = element.closest<HTMLElement>(selector);
  if (!target) {
    return null;
  }

  const raw = target.dataset[attributeName];
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

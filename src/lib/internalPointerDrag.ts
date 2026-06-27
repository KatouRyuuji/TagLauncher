import type { PointerEvent as ReactPointerEvent } from "react";
import {
  type InternalDragHoverTarget,
  type InternalDragPayload,
  useInternalDragStore,
} from "../stores/internalDragStore";

const DRAG_THRESHOLD = 6;

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

  const cleanup = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingMove = null;
    window.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("pointerup", handlePointerUp, true);
    window.removeEventListener("pointercancel", handlePointerCancel, true);
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
    useInternalDragStore.getState().updateDrag(moveEvent.clientX, moveEvent.clientY);
    useInternalDragStore.getState().setHoverTarget(findHoverTarget(moveEvent));
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
      document.body.style.userSelect = "none";
      useInternalDragStore.getState().startDrag(payload, moveEvent.clientX, moveEvent.clientY);
      useInternalDragStore.getState().setHoverTarget(findHoverTarget(moveEvent));
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

  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("pointercancel", handlePointerCancel, true);
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

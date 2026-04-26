import { useEffect, useRef, useState } from "react";

interface SelectionCanvasProps {
  itemIds: number[];
  selectedItemIds: number[];
  onSelectItems: (itemIds: number[]) => void;
  children: React.ReactNode;
  className?: string;
  dataRegion?: string;
}

interface Rect {
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

export function SelectionCanvas({
  itemIds,
  selectedItemIds,
  onSelectItems,
  children,
  className,
  dataRegion,
}: SelectionCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean } | null>(null);
  const selectedItemIdsRef = useRef(selectedItemIds);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  useEffect(() => {
    selectedItemIdsRef.current = selectedItemIds;
  }, [selectedItemIds]);

  useEffect(() => {
    const selected = new Set(selectedItemIds);
    const next = itemIds.filter((id) => selected.has(id));
    if (!sameNumberArray(next, selectedItemIds)) {
      onSelectItems(next);
    }
  }, [itemIds, onSelectItems, selectedItemIds]);

  const collectIntersectingItems = (selectionRect: Rect) => {
    const container = containerRef.current;
    if (!container) return [];

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
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!shouldStartSelection(event.target, event.currentTarget)) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
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

    const selectionRect = getSelectionRect(drag.startX, drag.startY, event.clientX, event.clientY);
    setSelectionBox(toSelectionBox(selectionRect, container));
    const nextItemIds = collectIntersectingItems(selectionRect);
    if (!sameNumberArray(nextItemIds, selectedItemIdsRef.current)) {
      selectedItemIdsRef.current = nextItemIds;
      onSelectItems(nextItemIds);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      if (selectedItemIdsRef.current.length > 0) {
        onSelectItems([]);
      }
    }

    setSelectionBox(null);
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setSelectionBox(null);
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={containerRef}
      data-region={dataRegion}
      className={`relative ${className ?? ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
            zIndex: "var(--z-context-overlay)" as unknown as number,
          }}
        />
      )}
    </div>
  );
}

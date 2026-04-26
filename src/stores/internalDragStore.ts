import { create } from "zustand";

export type InternalDragHoverTarget =
  | { kind: "tag-item"; itemId: number }
  | { kind: "item-cabinet"; cabinetId: number }
  | { kind: "item-favorites" }
  | { kind: "item-clear-current-filter" }
  | { kind: "item-remove-from-app" }
  | { kind: "reorder-tag"; itemId: number; targetIdx: number }
  | { kind: "reorder-remove"; itemId: number }
  | null;

export type InternalDragPayload =
  | { kind: "tag"; tagId: number; label: string; color: string }
  | { kind: "item"; itemId: number; label: string }
  | {
      kind: "reorder-tag";
      itemId: number;
      sourceIdx: number;
      tagId: number;
      label: string;
      color: string;
      tagIds: number[];
    };

export interface InternalDragState {
  drag: (InternalDragPayload & { x: number; y: number }) | null;
  hoverTarget: InternalDragHoverTarget;
  suppressClickUntil: number;
  startDrag: (payload: InternalDragPayload, x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  setHoverTarget: (target: InternalDragHoverTarget) => void;
  finishDrag: () => void;
  suppressClicks: () => void;
}

function sameHoverTarget(a: InternalDragHoverTarget, b: InternalDragHoverTarget): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.kind !== b.kind) return false;

  switch (a.kind) {
    case "tag-item":
      return b.kind === "tag-item" && a.itemId === b.itemId;
    case "item-cabinet":
      return b.kind === "item-cabinet" && a.cabinetId === b.cabinetId;
    case "item-favorites":
    case "item-clear-current-filter":
    case "item-remove-from-app":
      return true;
    case "reorder-tag":
      return b.kind === "reorder-tag" && a.itemId === b.itemId && a.targetIdx === b.targetIdx;
    case "reorder-remove":
      return b.kind === "reorder-remove" && a.itemId === b.itemId;
  }
}

export const useInternalDragStore = create<InternalDragState>((set) => ({
  drag: null,
  hoverTarget: null,
  suppressClickUntil: 0,
  startDrag: (payload, x, y) => set({ drag: { ...payload, x, y }, hoverTarget: null }),
  updateDrag: (x, y) =>
    set((state) => (state.drag ? { drag: { ...state.drag, x, y } } : state)),
  setHoverTarget: (target) =>
    set((state) => (sameHoverTarget(state.hoverTarget, target) ? state : { hoverTarget: target })),
  finishDrag: () => set({ drag: null, hoverTarget: null }),
  suppressClicks: () => set({ suppressClickUntil: Date.now() + 250 }),
}));

export function shouldSuppressInternalDragClick(): boolean {
  return useInternalDragStore.getState().suppressClickUntil > Date.now();
}

import { useEffect, useSyncExternalStore } from "react";

/** 右键菜单等浮层打开时，底栏批量条让位，避免两套命令同时占住下半屏。 */
let depth = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function pushOverlay() {
  depth += 1;
  emit();
}

export function popOverlay() {
  depth = Math.max(0, depth - 1);
  emit();
}

function overlayOpen() {
  return depth > 0;
}

function subscribeOverlay(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useOverlayOpen() {
  return useSyncExternalStore(subscribeOverlay, overlayOpen, () => false);
}

export function useOverlayGate() {
  useEffect(() => {
    pushOverlay();
    return () => popOverlay();
  }, []);
}

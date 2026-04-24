// ============================================================================
// lib/modItemSlotRegistry.ts — Mod ItemCard 插槽注册表
// ============================================================================
// 为 Mod 提供在 ItemCard 中注入自定义内容的能力。
//
// 使用方式（在 mod JS 中）：
//   const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
//   api.registerItemSlot("footer", (item) => {
//     const el = document.createElement("div");
//     el.textContent = `自定义: ${item.name}`;
//     return el;
//   });
//
// 设计原则：
//   - position 支持 "header" | "footer" | "actions"
//   - render 接收 ItemWithTags，返回 HTMLElement
//   - React 组件通过 ref + useEffect 将 HTMLElement 挂载到 DOM
//   - 禁用 mod 时自动移除该 mod 的所有插槽
// ============================================================================

import type { ItemWithTags } from "../types";

export type ItemSlotPosition = "header" | "footer" | "actions";

export interface ItemSlotDescriptor {
  id: string;
  modId: string;
  position: ItemSlotPosition;
  render: (item: ItemWithTags) => HTMLElement;
}

// ── 内部状态 ──────────────────────────────────────────────────────────────

const slots = new Map<string, ItemSlotDescriptor>();
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* */ }
  }
}

function makeKey(modId: string, slotId: string): string {
  return `${modId}::${slotId}`;
}

// ── 公开 API ──────────────────────────────────────────────────────────────

export function registerItemSlot(
  modId: string,
  slotId: string,
  position: ItemSlotPosition,
  render: (item: ItemWithTags) => HTMLElement,
): void {
  const key = makeKey(modId, slotId);
  slots.set(key, { id: slotId, modId, position, render });
  notify();
}

export function unregisterItemSlot(modId: string, slotId: string): void {
  const key = makeKey(modId, slotId);
  if (slots.delete(key)) {
    notify();
  }
}

export function unregisterAllItemSlots(modId: string): void {
  let changed = false;
  for (const [key, s] of slots) {
    if (s.modId === modId) {
      slots.delete(key);
      changed = true;
    }
  }
  if (changed) notify();
}

export function getItemSlotsForPosition(position: ItemSlotPosition): ItemSlotDescriptor[] {
  return Array.from(slots.values()).filter((s) => s.position === position);
}

export function getAllItemSlots(): ItemSlotDescriptor[] {
  return Array.from(slots.values());
}

export function subscribeItemSlots(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

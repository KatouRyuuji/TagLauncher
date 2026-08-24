// ============================================================================
// lib/panelRegistry.ts — Mod Panel 桥接层
// ============================================================================
// 连接 mod JS（同步调用 createPanel）与 React 树（异步渲染容器 div）。
//
// 流程：
//   mod JS 调用 api.createPanel(id, opts)
//     → requestPanel() 发出 DOM 事件 "taglauncher-panel-create"
//     → React 组件监听事件，把描述符 push 进 state，渲染容器 div
//     → ref callback 调用 resolvePanel(fullId, contentEl)
//     → Promise resolve，mod 拿到 PanelHandle
//
// show/hide/close/setTitle 通过 DOM 事件通知 React 更新 state，避免直接
// 操作 React 内部状态。
// ============================================================================

import type { PanelOptions, PanelHandle, PanelDescriptor, PanelEvent } from "../types/panel";

// ── 自定义事件名常量 ──────────────────────────────────────────────────────

export const PANEL_CREATE  = "taglauncher-panel-create";
export const PANEL_DESTROY = "taglauncher-panel-destroy";
export const PANEL_SHOW    = "taglauncher-panel-show";
export const PANEL_HIDE    = "taglauncher-panel-hide";
export const PANEL_TITLE   = "taglauncher-panel-settitle";

// ── 内部状态 ──────────────────────────────────────────────────────────────

/** 等待 React 挂载容器的队列 */
const pendingMap = new Map<string, {
  promise: Promise<PanelHandle>;
  resolve: (handle: PanelHandle) => void;
  reject:  (reason: Error) => void;
  timerId: number;
}>();

/** 已激活的面板（fullId → PanelHandle） */
const activePanels = new Map<string, PanelHandle>();

/** modId → 该 mod 创建的所有面板 fullId */
const modPanelsMap = new Map<string, Set<string>>();

/** 面板内部事件监听器（fullId → event → Set<cb>） */
const panelListeners = new Map<string, Map<PanelEvent, Set<(data?: unknown) => void>>>();

// ── 工具函数 ──────────────────────────────────────────────────────────────

function splitId(fullId: string): { modId: string; panelId: string } {
  const sep = fullId.indexOf("::");
  return {
    modId:   sep >= 0 ? fullId.slice(0, sep) : fullId,
    panelId: sep >= 0 ? fullId.slice(sep + 2) : "",
  };
}

function buildDescriptor(fullId: string, modId: string, opts: PanelOptions): PanelDescriptor {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = opts.width  ?? 320;
  const h = opts.height ?? 240;
  // 视口钳制：mod 传入越界坐标时面板将永久无法找回，钳制到可视区域内
  const clampX = (x: number) => Math.max(0, Math.min(x, Math.max(0, W - w)));
  const clampY = (y: number) => Math.max(0, Math.min(y, Math.max(0, H - h)));
  return {
    id:           fullId,
    modId,
    position:     opts.position,
    title:        opts.title ?? fullId,
    width:        w,
    height:       h,
    x:            clampX(opts.x ?? Math.round((W - w) / 2)),
    y:            clampY(opts.y ?? Math.round((H - h) / 2)),
    resizable:    opts.resizable  ?? true,
    collapsible:  opts.collapsible ?? true,
    modalButtons: opts.modalButtons ?? [],
    visible:      true,
  };
}

// ── 公开 API ──────────────────────────────────────────────────────────────

/**
 * mod 调用入口：请求创建一个 Panel。
 * 返回 Promise<PanelHandle>，在 React 挂载容器 div 后 resolve。
 * 同一 fullId 二次调用时直接返回已有 handle。
 */
export function requestPanel(
  modId: string,
  panelId: string,
  opts: PanelOptions,
): Promise<PanelHandle> {
  const fullId = `${modId}::${panelId}`;

  // 幂等：同 id 已存在直接返回
  const existing = activePanels.get(fullId);
  if (existing) return Promise.resolve(existing);

  // 并发防护：同 id 的创建仍在等待 React 挂载时，共享同一个 Promise，
  // 避免第二次调用覆盖 pending 记录导致首个调用方悬挂、旧定时器误清理新记录
  const pendingExisting = pendingMap.get(fullId);
  if (pendingExisting) return pendingExisting.promise;

  // 记录 mod → panels 映射
  if (!modPanelsMap.has(modId)) modPanelsMap.set(modId, new Set());
  modPanelsMap.get(modId)!.add(fullId);

  // 初始化事件监听器 map
  panelListeners.set(fullId, new Map());

  let resolveFn!: (handle: PanelHandle) => void;
  let rejectFn!: (reason: Error) => void;
  const promise = new Promise<PanelHandle>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const timerId = window.setTimeout(() => {
    pendingMap.delete(fullId);
    // 超时后同步清理登记，避免 React 延迟挂载时面板成为无法销毁的孤儿
    panelListeners.delete(fullId);
    modPanelsMap.get(modId)?.delete(fullId);
    window.dispatchEvent(new CustomEvent<string>(PANEL_DESTROY, { detail: fullId }));
    rejectFn(new Error(`Panel "${fullId}" 创建超时（5s 内 React 未挂载容器）`));
  }, 5000);

  pendingMap.set(fullId, { promise, resolve: resolveFn, reject: rejectFn, timerId });

  // 通知 React 渲染容器
  const desc = buildDescriptor(fullId, modId, opts);
  window.dispatchEvent(new CustomEvent<PanelDescriptor>(PANEL_CREATE, { detail: desc }));

  return promise;
}

/**
 * React ref callback 调用：容器 div 已挂载，构建 PanelHandle 并 resolve Promise。
 * 若被重复调用（React 重渲染），更新 container 引用但不重新 resolve。
 */
export function resolvePanel(fullId: string, contentEl: HTMLElement): void {
  const pending = pendingMap.get(fullId);
  if (pending) {
    clearTimeout(pending.timerId);
    pendingMap.delete(fullId);

    const handle = buildPanelHandle(fullId, contentEl);
    activePanels.set(fullId, handle);
    pending.resolve(handle);
    return;
  }

  // 已 resolve：更新现有 handle 的 container 引用（应对 React 重挂载）
  const existing = activePanels.get(fullId);
  if (existing) {
    existing.container = contentEl;
  }
}

/**
 * 销毁指定 Panel（handle.close() 或外部调用）。
 * 触发 React 卸载容器，清理内部状态。
 * 注意：先对监听器取快照、再清理注册表、最后派发 close——
 * 既保证已注册的 close 监听能被调用，又让监听内重入 close() 被上方守卫拦截。
 */
export function destroyPanel(fullId: string): void {
  const { modId } = splitId(fullId);

  // 重入守卫：若已在销毁过程中，直接返回
  if (!activePanels.has(fullId) && !pendingMap.has(fullId)) return;

  // 取消 pending（若 React 还未挂载）：必须 reject，否则 mod 侧
  // `await api.createPanel(...)` 永久悬挂，后续逻辑（含清理注册）静默丢失。
  const pending = pendingMap.get(fullId);
  if (pending) {
    clearTimeout(pending.timerId);
    pendingMap.delete(fullId);
    pending.reject(new Error(`Panel "${fullId}" 在挂载完成前被销毁（mod 被禁用/重载）`));
  }

  // 快照 close 监听器，然后清理内部状态（防止 close 回调重入）
  const closeListeners = panelListeners.get(fullId)?.get("close");
  activePanels.delete(fullId);
  panelListeners.delete(fullId);
  modPanelsMap.get(modId)?.delete(fullId);

  // 向快照派发 "close" 事件（注册表已清理，回调里再 close() 是 no-op）
  if (closeListeners) {
    for (const cb of Array.from(closeListeners)) {
      try { cb(); } catch { /* 静默忽略 mod 事件回调中的异常 */ }
    }
  }

  // 通知 React 卸载容器
  window.dispatchEvent(new CustomEvent<string>(PANEL_DESTROY, { detail: fullId }));
}

/**
 * 批量销毁某个 mod 创建的所有 Panel（disableModRuntime 调用）。
 */
export function destroyAllForMod(modId: string): void {
  const panels = modPanelsMap.get(modId);
  if (!panels) return;
  for (const fullId of Array.from(panels)) {
    destroyPanel(fullId);
  }
  modPanelsMap.delete(modId);
}

/**
 * React 组件调用：触发面板内部事件监听器（close/show/hide/modal-* 等）。
 */
export function firePanelEvent(fullId: string, event: PanelEvent, data?: unknown): void {
  const listeners = panelListeners.get(fullId)?.get(event);
  if (!listeners) return;
  for (const cb of listeners) {
    try { cb(data); } catch { /* 静默忽略 mod 事件回调中的异常 */ }
  }
}

// ── PanelHandle 工厂 ─────────────────────────────────────────────────────

function buildPanelHandle(fullId: string, contentEl: HTMLElement): PanelHandle {
  return {
    id:        fullId,
    container: contentEl,

    show() {
      window.dispatchEvent(new CustomEvent<string>(PANEL_SHOW, { detail: fullId }));
      firePanelEvent(fullId, "show");
    },

    hide() {
      window.dispatchEvent(new CustomEvent<string>(PANEL_HIDE, { detail: fullId }));
      firePanelEvent(fullId, "hide");
    },

    close() {
      destroyPanel(fullId);
    },

    setTitle(title: string) {
      window.dispatchEvent(
        new CustomEvent<{ id: string; title: string }>(PANEL_TITLE, {
          detail: { id: fullId, title },
        }),
      );
    },

    on(event: PanelEvent, cb: (data?: unknown) => void) {
      const map = panelListeners.get(fullId);
      if (!map) return () => {};
      if (!map.has(event)) map.set(event, new Set());
      map.get(event)!.add(cb);
      return () => { map.get(event)?.delete(cb); };
    },
  };
}

// ── 调试接口 ─────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__tagLauncherPanels = {
    getActive:  () => Array.from(activePanels.keys()),
    getPending: () => Array.from(pendingMap.keys()),
  };
}

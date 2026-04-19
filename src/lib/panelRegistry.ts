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
  return {
    id:           fullId,
    modId,
    position:     opts.position,
    title:        opts.title ?? fullId,
    width:        w,
    height:       h,
    x:            opts.x ?? Math.round((W - w) / 2),
    y:            opts.y ?? Math.round((H - h) / 2),
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

  // 记录 mod → panels 映射
  if (!modPanelsMap.has(modId)) modPanelsMap.set(modId, new Set());
  modPanelsMap.get(modId)!.add(fullId);

  // 初始化事件监听器 map
  panelListeners.set(fullId, new Map());

  return new Promise<PanelHandle>((resolve, reject) => {
    const timerId = window.setTimeout(() => {
      pendingMap.delete(fullId);
      reject(new Error(`Panel "${fullId}" 创建超时（5s 内 React 未挂载容器）`));
    }, 5000);

    pendingMap.set(fullId, { resolve, reject, timerId });

    // 通知 React 渲染容器
    const desc = buildDescriptor(fullId, modId, opts);
    window.dispatchEvent(new CustomEvent<PanelDescriptor>(PANEL_CREATE, { detail: desc }));
  });
}

/**
 * React ref callback 调用：容器 div 已挂载，构建 PanelHandle 并 resolve Promise。
 * 若被重复调用（React 重渲染），更新 container 引用但不重新 resolve。
 */
export function resolvePanel(fullId: string, contentEl: HTMLElement): void {
  const pending = pendingMap.get(fullId);
  if (!pending) {
    // 已 resolve（React 重渲染时再次触发 ref callback），无需处理
    return;
  }

  clearTimeout(pending.timerId);
  pendingMap.delete(fullId);

  const handle = buildPanelHandle(fullId, contentEl);
  activePanels.set(fullId, handle);
  pending.resolve(handle);
}

/**
 * 销毁指定 Panel（handle.close() 或外部调用）。
 * 触发 React 卸载容器，清理内部状态。
 */
export function destroyPanel(fullId: string): void {
  const { modId } = splitId(fullId);

  // 取消 pending（若 React 还未挂载）
  const pending = pendingMap.get(fullId);
  if (pending) {
    clearTimeout(pending.timerId);
    pendingMap.delete(fullId);
  }

  // 触发 "close" 事件
  firePanelEvent(fullId, "close");

  // 清理内部状态
  activePanels.delete(fullId);
  panelListeners.delete(fullId);
  modPanelsMap.get(modId)?.delete(fullId);

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

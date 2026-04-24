// ============================================================================
// lib/modToolbarRegistry.ts — Mod Toolbar 按钮注册表
// ============================================================================
// 为 Mod 提供在应用顶部工具栏注入快捷按钮的能力。
//
// 使用方式（在 mod JS 中）：
//   const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
//   api.createToolbarButton("my-btn", {
//     text: "快捷操作",
//     icon: "<svg>...</svg>",
//     onClick: () => console.log("clicked"),
//   });
//
// 设计原则：
//   - 按钮按 modId 分组，禁用 mod 时自动移除该 mod 的所有按钮
//   - 按钮样式跟随宿主主题，通过 data-mod-toolbar 属性标识
//   - 使用订阅模式通知 React 组件重新渲染
// ============================================================================

export interface ToolbarButtonOptions {
  /** 按钮文字 */
  text: string;
  /** 可选的 SVG 图标字符串 */
  icon?: string;
  /** 点击回调 */
  onClick: () => void;
}

export interface ToolbarButtonDescriptor {
  id: string;
  modId: string;
  text: string;
  icon?: string;
  onClick: () => void;
}

// ── 内部状态 ──────────────────────────────────────────────────────────────

const buttons = new Map<string, ToolbarButtonDescriptor>();
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* */ }
  }
}

function makeKey(modId: string, buttonId: string): string {
  return `${modId}::${buttonId}`;
}

// ── 公开 API ──────────────────────────────────────────────────────────────

export function registerToolbarButton(
  modId: string,
  buttonId: string,
  opts: ToolbarButtonOptions,
): void {
  const key = makeKey(modId, buttonId);
  buttons.set(key, {
    id: buttonId,
    modId,
    text: opts.text,
    icon: opts.icon,
    onClick: opts.onClick,
  });
  notify();
}

export function unregisterToolbarButton(modId: string, buttonId: string): void {
  const key = makeKey(modId, buttonId);
  if (buttons.delete(key)) {
    notify();
  }
}

export function unregisterAllToolbarButtons(modId: string): void {
  let changed = false;
  for (const [key, btn] of buttons) {
    if (btn.modId === modId) {
      buttons.delete(key);
      changed = true;
    }
  }
  if (changed) notify();
}

export function getToolbarButtons(): ToolbarButtonDescriptor[] {
  return Array.from(buttons.values());
}

export function subscribeToolbarButtons(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

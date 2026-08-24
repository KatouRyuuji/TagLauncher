export const WORKSPACE_SEARCH_ID = "workspace-search";
export const SEARCH_RESET_EVENT = "taglauncher-search-reset";

export function focusWorkspaceSearch(): void {
  const el = document.getElementById(WORKSPACE_SEARCH_ID);
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

export function resetWorkspaceSearchInput(): void {
  window.dispatchEvent(new Event(SEARCH_RESET_EVENT));
}

export function scrollItemIntoView(itemId: number): void {
  const el = document.querySelector(`[data-selectable-item-id="${itemId}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/**
 * 会抢走键盘的宿主遮罩。所有全屏弹层须带 data-workspace-overlay。
 * 查询串须与 ExampleMod/preview/preview.js 保持一致。
 */
export const WORKSPACE_KEY_BLOCKING_OVERLAYS = "[data-workspace-overlay]";

/** 示例 Mod 等 createPanel({ position: "modal" }) 打开时，工作台快捷键应让路。 */
export function isModModalOpen(): boolean {
  return Boolean(document.querySelector("[data-mod-modal]"));
}

export function isContextMenuOpen(): boolean {
  return Boolean(document.querySelector("[data-context-menu]"));
}

/** 右键菜单或批量工具条下拉打开时，工作台方向键 / Delete / G 应让路。 */
export function isTransientMenuOpen(): boolean {
  return isContextMenuOpen() || Boolean(document.querySelector("[data-floating-menu]"));
}

/** 在指定对象上打开右键菜单（虚拟化未挂载时先滚入视口再派发）。 */
export function openItemContextMenu(itemId: number): void {
  const fire = (): boolean => {
    const el = document.querySelector(`[data-selectable-item-id="${itemId}"]`);
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(rect.left + Math.min(16, rect.width / 2)),
        clientY: Math.round(rect.top + Math.min(16, rect.height / 2)),
        button: 2,
      }),
    );
    return true;
  };

  scrollItemIntoView(itemId);
  if (fire()) return;
  requestAnimationFrame(() => {
    if (!fire()) requestAnimationFrame(() => { fire(); });
  });
}

let workspaceGridLanes = 1;

/** ItemGrid 测量列数后写入，供键盘上下键按列跳转；列表视图卸载时复位为 1。 */
export function setWorkspaceGridLanes(lanes: number): void {
  workspaceGridLanes = Math.max(1, Math.floor(lanes) || 1);
}

export function getWorkspaceGridLanes(): number {
  return workspaceGridLanes;
}

/**
 * 虚拟化网格的 overscan 行数：一行渲染 lanes 张卡片，列数越多预渲染一行越贵，
 * 相应减少行数；窄窗口单列时行很便宜，多预渲染几行让滚动更顺滑。
 */
export function gridOverscanRows(lanes: number): number {
  const n = Math.max(1, Math.floor(lanes) || 1);
  if (n <= 1) return 6;
  if (n <= 2) return 4;
  if (n <= 4) return 3;
  return 2;
}

let selectionAnchorId: number | null = null;

/** 键盘与鼠标点选共用的范围选择锚点。 */
export function setWorkspaceSelectionAnchor(id: number | null): void {
  selectionAnchorId = id;
}

export function getWorkspaceSelectionAnchor(): number | null {
  return selectionAnchorId;
}

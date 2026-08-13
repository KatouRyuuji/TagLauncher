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

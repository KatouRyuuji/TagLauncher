import { useEffect, useRef } from "react";
import { copyText } from "../lib/clipboard";
import {
  formatPathCopy,
  isTypingTarget,
  nextSelectionIndex,
  previewNavigationItems,
  rangeSelectionIds,
  selectionStep,
} from "../lib/itemQuery";
import {
  focusWorkspaceSearch,
  getWorkspaceGridLanes,
  getWorkspaceSelectionAnchor,
  isModModalOpen,
  isTransientMenuOpen,
  openItemContextMenu,
  resetWorkspaceSearchInput,
  scrollItemIntoView,
  setWorkspaceSelectionAnchor,
} from "../lib/workspaceChrome";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";

interface WorkspaceHotkeysOptions {
  blocked: boolean;
  items: ItemWithTags[];
  allItems: ItemWithTags[];
  selectedItemIds: number[];
  setSelectedItemIds: (ids: number[]) => void;
  onLaunch: (id: number) => void;
  onRemoveSelected: () => void;
  onToggleSelectedFavorite: () => void;
  onOpenSettings: () => void;
}

export function useWorkspaceHotkeys({
  blocked,
  items,
  allItems,
  selectedItemIds,
  setSelectedItemIds,
  onLaunch,
  onRemoveSelected,
  onToggleSelectedFavorite,
  onOpenSettings,
}: WorkspaceHotkeysOptions): void {
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const shortcutsHelpOpen = useAppStore((state) => state.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const previewItemId = useAppStore((state) => state.previewItemId);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);

  const refs = useRef({
    allItems,
    blocked,
    commandPaletteOpen,
    items,
    onLaunch,
    onOpenSettings,
    onRemoveSelected,
    onToggleSelectedFavorite,
    previewItemId,
    searchQuery,
    selectedItemIds,
    setCommandPaletteOpen,
    setPreviewItemId,
    setSearchQuery,
    setSelectedItemIds,
    setShortcutsHelpOpen,
    setViewMode,
    shortcutsHelpOpen,
    viewMode,
  });
  refs.current = {
    allItems,
    blocked,
    commandPaletteOpen,
    items,
    onLaunch,
    onOpenSettings,
    onRemoveSelected,
    onToggleSelectedFavorite,
    previewItemId,
    searchQuery,
    selectedItemIds,
    setCommandPaletteOpen,
    setPreviewItemId,
    setSearchQuery,
    setSelectedItemIds,
    setShortcutsHelpOpen,
    setViewMode,
    shortcutsHelpOpen,
    viewMode,
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const ctx = refs.current;
      const typing = isTypingTarget(event.target);
      const onButton = event.target instanceof HTMLElement && event.target.closest("button, a, [role='menuitem']") !== null;
      const ctrl = event.ctrlKey || event.metaKey;
      const composing = event.isComposing || event.key === "Process";

      if (ctrl && event.key.toLowerCase() === "k") {
        event.preventDefault();
        ctx.setCommandPaletteOpen(!ctx.commandPaletteOpen);
        return;
      }

      if (ctx.commandPaletteOpen || ctx.shortcutsHelpOpen) return;
      if (composing) return;
      if (isModModalOpen()) return;
      if (isTransientMenuOpen()) return;
      if (ctx.blocked) return;
      if (event.defaultPrevented) return;

      if (ctrl && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusWorkspaceSearch();
        return;
      }

      if (ctrl && event.key === ",") {
        event.preventDefault();
        ctx.onOpenSettings();
        return;
      }

      if (ctrl && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        ctx.setSelectedItemIds(ctx.items.map((item) => item.id));
        setWorkspaceSelectionAnchor(ctx.items[0]?.id ?? null);
        return;
      }

      if (ctrl && event.key.toLowerCase() === "c" && !typing) {
        const idSet = new Set(ctx.selectedItemIds);
        const payload = formatPathCopy(
          ctx.items.filter((item) => idSet.has(item.id)).map((item) => item.path),
        );
        if (payload) {
          event.preventDefault();
          void copyText(payload.text, payload.message);
        }
        return;
      }

      if (ctrl && event.key.toLowerCase() === "d" && !typing) {
        if (ctx.selectedItemIds.length > 0) {
          event.preventDefault();
          ctx.onToggleSelectedFavorite();
        }
        return;
      }

      if (ctx.previewItemId !== null) {
        if (event.key === " " && !typing) {
          event.preventDefault();
          ctx.setPreviewItemId(null);
          return;
        }
        const previewList = previewNavigationItems(ctx.items, ctx.allItems, ctx.previewItemId);
        if (event.key === "Home") {
          event.preventDefault();
          jumpPreview(previewList, ctx.items, 0, ctx.setPreviewItemId, ctx.setSelectedItemIds);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          jumpPreview(previewList, ctx.items, previewList.length - 1, ctx.setPreviewItemId, ctx.setSelectedItemIds);
          return;
        }
        const previewDelta = selectionStep(ctx.viewMode, getWorkspaceGridLanes(), event.key);
        if (previewDelta != null) {
          event.preventDefault();
          movePreview(previewList, ctx.items, ctx.previewItemId, previewDelta, ctx.setPreviewItemId, ctx.setSelectedItemIds);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          ctx.setPreviewItemId(null);
          ctx.onLaunch(ctx.previewItemId);
          return;
        }
        return;
      }

      if (typing) {
        if (event.key === "Escape" && event.target instanceof HTMLElement && event.target.id === "workspace-search") {
          if (ctx.searchQuery || (event.target instanceof HTMLInputElement && event.target.value)) {
            event.preventDefault();
            ctx.setSearchQuery("");
            resetWorkspaceSearchInput();
            event.target.blur();
          }
        }
        return;
      }

      if (event.altKey) return;

      if (!ctrl && (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) {
        const item = pickSelectedItem(ctx.items, ctx.selectedItemIds);
        if (item) {
          event.preventDefault();
          openItemContextMenu(item.id);
        }
        return;
      }

      if (event.key === "/" && !event.shiftKey) {
        event.preventDefault();
        focusWorkspaceSearch();
        return;
      }

      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        ctx.setShortcutsHelpOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (ctx.searchQuery) {
          ctx.setSearchQuery("");
          resetWorkspaceSearchInput();
          return;
        }
        if (ctx.selectedItemIds.length > 0) {
          ctx.setSelectedItemIds([]);
          setWorkspaceSelectionAnchor(null);
        }
        return;
      }

      if (!ctrl && (event.key === "g" || event.key === "G")) {
        ctx.setViewMode("grid");
        return;
      }
      if (!ctrl && (event.key === "l" || event.key === "L")) {
        ctx.setViewMode("list");
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        if (event.shiftKey) {
          extendSelection(ctx.items, ctx.selectedItemIds, 0, ctx.setSelectedItemIds);
        } else {
          jumpSelection(ctx.items, 0, ctx.setSelectedItemIds);
          setWorkspaceSelectionAnchor(ctx.items[0]?.id ?? null);
        }
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const last = ctx.items.length - 1;
        if (event.shiftKey) {
          extendSelection(ctx.items, ctx.selectedItemIds, last, ctx.setSelectedItemIds);
        } else {
          jumpSelection(ctx.items, last, ctx.setSelectedItemIds);
          setWorkspaceSelectionAnchor(ctx.items[last]?.id ?? null);
        }
        return;
      }

      const delta = selectionStep(ctx.viewMode, getWorkspaceGridLanes(), event.key);
      if (delta != null) {
        event.preventDefault();
        if (event.shiftKey) {
          const currentId = ctx.selectedItemIds[ctx.selectedItemIds.length - 1];
          const currentIndex = currentId == null ? -1 : ctx.items.findIndex((item) => item.id === currentId);
          const nextIndex = nextSelectionIndex(ctx.items.length, currentIndex, delta);
          extendSelection(ctx.items, ctx.selectedItemIds, nextIndex, ctx.setSelectedItemIds);
        } else {
          const nextId = moveSelection(ctx.items, ctx.selectedItemIds, delta, ctx.setSelectedItemIds);
          if (nextId != null) setWorkspaceSelectionAnchor(nextId);
        }
        return;
      }

      if (event.key === "Enter") {
        if (onButton) return;
        const item = pickSelectedItem(ctx.items, ctx.selectedItemIds);
        if (item) {
          event.preventDefault();
          ctx.onLaunch(item.id);
        }
        return;
      }

      if (event.key === " ") {
        if (onButton) return;
        const item = pickSelectedItem(ctx.items, ctx.selectedItemIds);
        if (item) {
          event.preventDefault();
          ctx.setPreviewItemId(item.id);
        }
        return;
      }

      if (event.key === "Delete" && ctx.selectedItemIds.length > 0) {
        event.preventDefault();
        ctx.onRemoveSelected();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function pickSelectedItem(items: ItemWithTags[], selectedItemIds: number[]): ItemWithTags | undefined {
  const id = selectedItemIds[selectedItemIds.length - 1];
  if (id == null) return undefined;
  return items.find((item) => item.id === id);
}

function selectVisible(
  visible: ItemWithTags[],
  item: ItemWithTags,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  if (!visible.some((entry) => entry.id === item.id)) return;
  setSelectedItemIds([item.id]);
  scrollItemIntoView(item.id);
}

function jumpSelection(
  items: ItemWithTags[],
  index: number,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const next = items[index];
  if (!next) return;
  setSelectedItemIds([next.id]);
  scrollItemIntoView(next.id);
}

function moveSelection(
  items: ItemWithTags[],
  selectedItemIds: number[],
  delta: number,
  setSelectedItemIds: (ids: number[]) => void,
): number | null {
  const currentId = selectedItemIds[selectedItemIds.length - 1];
  const currentIndex = currentId == null ? -1 : items.findIndex((item) => item.id === currentId);
  const nextIndex = nextSelectionIndex(items.length, currentIndex, delta);
  if (nextIndex < 0) return null;
  jumpSelection(items, nextIndex, setSelectedItemIds);
  return items[nextIndex]?.id ?? null;
}

function extendSelection(
  items: ItemWithTags[],
  selectedItemIds: number[],
  focusIndex: number,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const focus = items[focusIndex];
  if (!focus) return;
  let anchor = getWorkspaceSelectionAnchor();
  if (anchor == null) {
    anchor = selectedItemIds[0] ?? focus.id;
    setWorkspaceSelectionAnchor(anchor);
  }
  const ids = rangeSelectionIds(items, anchor, focus.id);
  if (ids.length === 0) return;
  setSelectedItemIds(ids);
  scrollItemIntoView(focus.id);
}

function jumpPreview(
  list: ItemWithTags[],
  visible: ItemWithTags[],
  index: number,
  setPreviewItemId: (id: number | null) => void,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const next = list[index];
  if (!next) return;
  setPreviewItemId(next.id);
  selectVisible(visible, next, setSelectedItemIds);
}

function movePreview(
  list: ItemWithTags[],
  visible: ItemWithTags[],
  previewItemId: number,
  delta: number,
  setPreviewItemId: (id: number | null) => void,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const currentIndex = list.findIndex((item) => item.id === previewItemId);
  const nextIndex = nextSelectionIndex(list.length, currentIndex, delta);
  jumpPreview(list, visible, nextIndex, setPreviewItemId, setSelectedItemIds);
}

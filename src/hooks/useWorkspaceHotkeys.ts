import { useEffect } from "react";
import { copyText } from "../lib/clipboard";
import { isTypingTarget, nextSelectionIndex } from "../lib/itemQuery";
import { focusWorkspaceSearch, resetWorkspaceSearchInput, scrollItemIntoView } from "../lib/workspaceChrome";
import { useAppStore } from "../stores/appStore";
import type { ItemWithTags } from "../types";

interface WorkspaceHotkeysOptions {
  blocked: boolean;
  items: ItemWithTags[];
  selectedItemIds: number[];
  setSelectedItemIds: (ids: number[]) => void;
  onLaunch: (id: number) => void;
  onRemoveSelected: () => void;
  onOpenSettings: () => void;
}

export function useWorkspaceHotkeys({
  blocked,
  items,
  selectedItemIds,
  setSelectedItemIds,
  onLaunch,
  onRemoveSelected,
  onOpenSettings,
}: WorkspaceHotkeysOptions): void {
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const shortcutsHelpOpen = useAppStore((state) => state.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useAppStore((state) => state.setShortcutsHelpOpen);
  const previewItemId = useAppStore((state) => state.previewItemId);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      const onButton = event.target instanceof HTMLElement && event.target.closest("button, a, [role='menuitem']") !== null;
      const ctrl = event.ctrlKey || event.metaKey;

      if (ctrl && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      if (commandPaletteOpen || shortcutsHelpOpen) return;

      if (previewItemId !== null) {
        if (event.key === " " && !typing) {
          event.preventDefault();
          setPreviewItemId(null);
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          movePreview(items, previewItemId, 1, setPreviewItemId, setSelectedItemIds);
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          movePreview(items, previewItemId, -1, setPreviewItemId, setSelectedItemIds);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          setPreviewItemId(null);
          onLaunch(previewItemId);
          return;
        }
        return;
      }

      if (blocked) return;

      if (ctrl && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusWorkspaceSearch();
        return;
      }

      if (ctrl && event.key === ",") {
        event.preventDefault();
        onOpenSettings();
        return;
      }

      if (ctrl && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        setSelectedItemIds(items.map((item) => item.id));
        return;
      }

      if (ctrl && event.key.toLowerCase() === "c" && !typing) {
        const item = pickActiveItem(items, selectedItemIds);
        if (item) {
          event.preventDefault();
          void copyText(item.path, "已复制路径");
        }
        return;
      }

      if (typing) {
        if (event.key === "Escape" && event.target instanceof HTMLElement && event.target.id === "workspace-search") {
          if (searchQuery || (event.target instanceof HTMLInputElement && event.target.value)) {
            event.preventDefault();
            setSearchQuery("");
            resetWorkspaceSearchInput();
            event.target.blur();
          }
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
        setShortcutsHelpOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
          resetWorkspaceSearchInput();
          return;
        }
        if (selectedItemIds.length > 0) {
          setSelectedItemIds([]);
        }
        return;
      }

      if (event.key === "g" || event.key === "G") {
        setViewMode("grid");
        return;
      }
      if (event.key === "l" || event.key === "L") {
        setViewMode("list");
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(items, selectedItemIds, 1, setSelectedItemIds);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(items, selectedItemIds, -1, setSelectedItemIds);
        return;
      }

      if (event.key === "Enter") {
        if (onButton) return;
        const item = pickActiveItem(items, selectedItemIds);
        if (item) {
          event.preventDefault();
          onLaunch(item.id);
        }
        return;
      }

      if (event.key === " ") {
        if (onButton) return;
        const item = pickActiveItem(items, selectedItemIds);
        if (item) {
          event.preventDefault();
          setPreviewItemId(item.id);
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedItemIds.length > 0) {
          event.preventDefault();
          onRemoveSelected();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    blocked,
    commandPaletteOpen,
    items,
    onLaunch,
    onOpenSettings,
    onRemoveSelected,
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
  ]);
}

function pickActiveItem(items: ItemWithTags[], selectedItemIds: number[]): ItemWithTags | undefined {
  const id = selectedItemIds[selectedItemIds.length - 1];
  if (id == null) return items[0];
  return items.find((item) => item.id === id) ?? items[0];
}

function moveSelection(
  items: ItemWithTags[],
  selectedItemIds: number[],
  delta: number,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const currentId = selectedItemIds[selectedItemIds.length - 1];
  const currentIndex = currentId == null ? -1 : items.findIndex((item) => item.id === currentId);
  const nextIndex = nextSelectionIndex(items.length, currentIndex, delta);
  if (nextIndex < 0) return;
  const next = items[nextIndex];
  setSelectedItemIds([next.id]);
  scrollItemIntoView(next.id);
}

function movePreview(
  items: ItemWithTags[],
  previewItemId: number,
  delta: number,
  setPreviewItemId: (id: number | null) => void,
  setSelectedItemIds: (ids: number[]) => void,
): void {
  const currentIndex = items.findIndex((item) => item.id === previewItemId);
  const nextIndex = nextSelectionIndex(items.length, currentIndex, delta);
  if (nextIndex < 0) return;
  const next = items[nextIndex];
  setPreviewItemId(next.id);
  setSelectedItemIds([next.id]);
}

// ============================================================================
// hooks/useFolderImport.ts — 添加路径时若含文件夹，让用户选择入库方式
// ============================================================================

import { useCallback, useRef, useState } from "react";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";
import {
  LINKED_CABINET_IMPORT_NOTICE,
  planNestedImport,
  snapshotImportPlacement,
  toAddItemsContext,
  type ImportPlacement,
} from "../lib/importContext";
import { useAppStore } from "../stores/appStore";

const FOLDER_IMPORT_MODE_KEY = "taglauncher.folder_import_mode";

export type FolderImportMode = "folder" | "contents" | "both";

export interface FolderImportDialogProps {
  open: boolean;
  folderNames: string[];
  fileCount: number;
  defaultMode: FolderImportMode;
  onConfirm: (mode: FolderImportMode, remember: boolean) => Promise<void>;
  onCancel: () => void;
}

function readLastMode(): FolderImportMode {
  try {
    const value = localStorage.getItem(FOLDER_IMPORT_MODE_KEY);
    if (value === "contents" || value === "both" || value === "folder") return value;
    return "folder";
  } catch {
    return "folder";
  }
}

function persistMode(mode: FolderImportMode): void {
  try {
    localStorage.setItem(FOLDER_IMPORT_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

function currentPlacement(): ImportPlacement {
  const state = useAppStore.getState();
  return snapshotImportPlacement({
    selectedCabinetId: state.selectedCabinetId,
    cabinets: state.cabinets,
    selectedTagIds: state.selectedTagIds,
    excludedTagIds: state.excludedTagIds,
    searchQuery: state.searchQuery,
  });
}

function noticeLinkedCabinet(placement: ImportPlacement): void {
  if (placement.linkedCabinetBlocked) {
    showToast(LINKED_CABINET_IMPORT_NOTICE, "info");
  }
}

export function useFolderImport(addItems: (paths: string[], context?: db.AddItemsContext) => Promise<void>) {
  const [pendingPaths, setPendingPaths] = useState<string[] | null>(null);
  const [folderNames, setFolderNames] = useState<string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [defaultMode, setDefaultMode] = useState<FolderImportMode>("folder");
  const placementRef = useRef<ImportPlacement | null>(null);
  const classifiedFilesRef = useRef<string[]>([]);

  const requestAddPaths = useCallback(async (paths: string[]) => {
    const normalized = Array.from(new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0)));
    if (normalized.length === 0) return;

    const placement = currentPlacement();
    placementRef.current = placement;

    try {
      const classified = await db.classifyImportPaths(normalized);
      if (classified.folders.length === 0) {
        noticeLinkedCabinet(placement);
        await addItems(classified.files, toAddItemsContext(placement, []));
        return;
      }

      setFolderNames(classified.folders);
      setFileCount(classified.files.length);
      classifiedFilesRef.current = classified.files;
      setDefaultMode(readLastMode());
      setPendingPaths(normalized);
    } catch (error) {
      showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [addItems]);

  const handleCancel = useCallback(() => {
    setPendingPaths(null);
    placementRef.current = null;
    classifiedFilesRef.current = [];
  }, []);

  const handleConfirm = useCallback(async (mode: FolderImportMode, remember: boolean) => {
    const paths = pendingPaths;
    const folders = folderNames;
    const placement = placementRef.current ?? currentPlacement();
    const droppedFiles = classifiedFilesRef.current;
    setPendingPaths(null);
    placementRef.current = null;
    classifiedFilesRef.current = [];
    if (!paths || paths.length === 0) return;

    if (remember) persistMode(mode);
    noticeLinkedCabinet(placement);
    try {
      if (mode === "folder") {
        const plan = planNestedImport({
          mode,
          droppedFolders: folders,
          droppedFiles,
          expandedFiles: [],
        });
        await addItems(plan.paths, toAddItemsContext(placement, plan.hideFromAllPaths));
        return;
      }

      const expanded = await db.expandFolderImport(paths);
      if (expanded.truncated) {
        showToast("文件夹很大，已先导入前 2000 个文件。其余请再选一次或分批添加。", "warning");
      }

      const plan = planNestedImport({
        mode,
        droppedFolders: folders,
        droppedFiles,
        expandedFiles: expanded.paths,
      });
      if (plan.paths.length === 0) {
        showToast(mode === "both" ? "这些文件夹里没有可导入的项目" : "这些文件夹里没有可导入的文件", "info");
        return;
      }
      await addItems(plan.paths, toAddItemsContext(placement, plan.hideFromAllPaths));
    } catch (error) {
      showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [addItems, folderNames, pendingPaths]);

  return {
    requestAddPaths,
    folderImportDialog: {
      open: pendingPaths !== null,
      folderNames,
      fileCount,
      defaultMode,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    } satisfies FolderImportDialogProps,
  };
}

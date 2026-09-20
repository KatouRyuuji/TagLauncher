// ============================================================================
// hooks/useFolderImport.ts — 添加路径时若含文件夹，让用户选择入库方式
// ============================================================================

import { useCallback, useState } from "react";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";

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

export function useFolderImport(addItems: (paths: string[]) => Promise<void>) {
  const [pendingPaths, setPendingPaths] = useState<string[] | null>(null);
  const [folderNames, setFolderNames] = useState<string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [defaultMode, setDefaultMode] = useState<FolderImportMode>("folder");

  const requestAddPaths = useCallback(async (paths: string[]) => {
    const normalized = Array.from(new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0)));
    if (normalized.length === 0) return;

    try {
      const classified = await db.classifyImportPaths(normalized);
      if (classified.folders.length === 0) {
        await addItems(classified.files);
        return;
      }

      setFolderNames(classified.folders);
      setFileCount(classified.files.length);
      setDefaultMode(readLastMode());
      setPendingPaths(normalized);
    } catch (error) {
      showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [addItems]);

  const handleCancel = useCallback(() => {
    setPendingPaths(null);
  }, []);

  const handleConfirm = useCallback(async (mode: FolderImportMode, remember: boolean) => {
    const paths = pendingPaths;
    const folders = folderNames;
    setPendingPaths(null);
    if (!paths || paths.length === 0) return;

    if (remember) persistMode(mode);
    try {
      if (mode === "folder") {
        await addItems(paths);
        return;
      }

      const expanded = await db.expandFolderImport(paths);
      if (expanded.truncated) {
        showToast("文件夹很大，已先导入前 2000 个文件。其余请再选一次或分批添加。", "warning");
      }

      if (mode === "both") {
        const combined = Array.from(new Set([...folders, ...expanded.paths]));
        if (combined.length === 0) {
          showToast("这些文件夹里没有可导入的项目", "info");
          return;
        }
        await addItems(combined);
        return;
      }

      if (expanded.paths.length === 0) {
        showToast("这些文件夹里没有可导入的文件", "info");
        return;
      }
      await addItems(expanded.paths);
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

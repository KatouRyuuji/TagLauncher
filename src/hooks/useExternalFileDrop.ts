// ============================================================================
// hooks/useExternalFileDrop.ts — 外部文件拖拽导入
// ============================================================================
// 整合两条外部拖拽通道并统一 dragOver 遮罩状态：
//   1) 原生 Tauri onDragDropEvent（window + webview）——WebView2 下更可靠；
//   2) React DOM 拖拽事件——补齐原生通道未覆盖的悬停反馈。
// 落点去重：同一批路径 800ms 内只真正导入一次，避免两条通道重复触发。
// 内部拖拽（标签/对象重排）激活时让位，不接管外部拖拽视觉。
// 从 App.tsx 抽离，行为完全保持一致。
// ============================================================================

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { useInternalDragStore } from "../stores/internalDragStore";
import { hasPotentialExternalFileDrag, extractDroppedPaths } from "../lib/dropPaths";

export interface ExternalFileDropHandlers {
  onDragEnter: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

export interface UseExternalFileDropResult {
  /** 是否正在外部文件拖拽悬停（用于显示"释放以添加文件"遮罩）。 */
  dragOver: boolean;
  /** 绑定到主内容区的 DOM 拖拽事件处理器。 */
  dragHandlers: ExternalFileDropHandlers;
}

export function useExternalFileDrop(
  addItems: (paths: string[]) => Promise<void>,
): UseExternalFileDropResult {
  const hasActiveInternalDrag = useInternalDragStore((state) => state.drag !== null);
  const hasActiveInternalDragRef = useRef(false);

  const [dragOver, setDragOver] = useState(false);
  const externalDragDepthRef = useRef(0);
  const recentDropRef = useRef<{ key: string; ts: number }>({ key: "", ts: 0 });
  const addDroppedPathsRef = useRef<(paths: string[]) => Promise<void>>(async () => {});

  useEffect(() => {
    hasActiveInternalDragRef.current = hasActiveInternalDrag;
    if (hasActiveInternalDrag) {
      externalDragDepthRef.current = 0;
      setDragOver(false);
    }
  }, [hasActiveInternalDrag]);

  const addDroppedPaths = useCallback(
    async (paths: string[]) => {
      const normalized = Array.from(
        new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0)),
      );
      if (normalized.length === 0) return;

      // 排序后生成去重 key：原生通道与 DOM 通道交付的路径顺序可能不同，
      // 不排序会导致同一批文件在 800ms 窗口内被判定为两次导入。
      const key = [...normalized].sort().join("\n");
      const now = Date.now();
      if (recentDropRef.current.key === key && now - recentDropRef.current.ts < 800) {
        return;
      }
      recentDropRef.current = { key, ts: now };

      await addItems(normalized);
    },
    [addItems],
  );

  useEffect(() => {
    addDroppedPathsRef.current = addDroppedPaths;
  }, [addDroppedPaths]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const handleNativeDragDropEvent = (event: { payload: DragDropEvent }) => {
      const eventType = event.payload.type;

      if (hasActiveInternalDragRef.current) {
        if (eventType === "leave" || eventType === "drop") {
          setDragOver(false);
        }
        return;
      }

      if (eventType === "enter" || eventType === "over") {
        setDragOver(true);
        return;
      }

      if (eventType === "leave") {
        setDragOver(false);
        return;
      }

      if (eventType === "drop") {
        externalDragDepthRef.current = 0;
        setDragOver(false);
        const paths = event.payload.paths;
        if (!paths || paths.length === 0) {
          return;
        }

        void addDroppedPathsRef.current(paths);
      }
    };

    const registerNativeListener = async (
      register: () => Promise<() => void>,
      label: string,
    ) => {
      try {
        const unlisten = await register();
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      } catch (error) {
        console.error(`Failed to register ${label} drag-drop listener:`, error);
      }
    };

    void registerNativeListener(
      () => getCurrentWindow().onDragDropEvent(handleNativeDragDropEvent),
      "window",
    );
    void registerNativeListener(
      () => getCurrentWebview().onDragDropEvent(handleNativeDragDropEvent),
      "webview",
    );

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  const onDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    externalDragDepthRef.current += 1;
    setDragOver(true);
  }, [hasActiveInternalDrag]);

  const onDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, [hasActiveInternalDrag]);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1);
    if (externalDragDepthRef.current === 0) {
      setDragOver(false);
    }
  }, [hasActiveInternalDrag]);

  const onDrop = useCallback((e: DragEvent<HTMLElement>) => {
    if (hasActiveInternalDrag) return;
    if (!hasPotentialExternalFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    externalDragDepthRef.current = 0;
    setDragOver(false);
    const paths = extractDroppedPaths(e.dataTransfer);
    if (paths.length === 0) return;
    void addDroppedPaths(paths);
  }, [addDroppedPaths, hasActiveInternalDrag]);

  return {
    dragOver,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}

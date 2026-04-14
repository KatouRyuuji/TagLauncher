// ============================================================================
// components/ToastContainer.tsx — 全局 Toast 通知
// ============================================================================
// 通过监听 "taglauncher-toast" CustomEvent 显示通知，无需 props 传递。
// mod JS 可以通过 window.__tagLauncherModApi.notify() 触发。
// 应用内部也可以 import { showToast } from "./ToastContainer" 调用。
// ============================================================================

import { useState, useEffect, useCallback } from "react";

export interface ToastMessage {
  id: number;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

const TOAST_DURATION = 3500; // ms

// ── 外部调用入口（应用内部使用）────────────────────────────────────────────

export function showToast(message: string, type: ToastMessage["type"] = "info") {
  window.dispatchEvent(
    new CustomEvent<{ message: string; type: ToastMessage["type"] }>("taglauncher-toast", {
      detail: { message, type },
    }),
  );
}

// ── 组件 ──────────────────────────────────────────────────────────────────

let nextId = 1;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent<{ message: string; type: ToastMessage["type"] }>).detail;
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-4), { id, message, type }]); // 最多显示 5 条
      setTimeout(() => dismiss(id), TOAST_DURATION);
    };
    window.addEventListener("taglauncher-toast", handler);
    return () => window.removeEventListener("taglauncher-toast", handler);
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[500] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border text-sm max-w-xs animate-in"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: toastBorderColor(toast.type),
            boxShadow: "var(--shadow-overlay)",
            color: "var(--text-primary)",
          }}
        >
          <span style={{ color: toastIconColor(toast.type), flexShrink: 0 }}>
            {toastIcon(toast.type)}
          </span>
          <span className="flex-1 truncate">{toast.message}</span>
          <button
            onClick={() => dismiss(toast.id)}
            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function toastIcon(type: ToastMessage["type"]) {
  switch (type) {
    case "success": return "✓";
    case "error":   return "✕";
    case "warning": return "⚠";
    default:        return "ℹ";
  }
}

function toastIconColor(type: ToastMessage["type"]) {
  switch (type) {
    case "success": return "var(--color-success)";
    case "error":   return "var(--color-danger)";
    case "warning": return "var(--color-warning)";
    default:        return "var(--accent-primary)";
  }
}

function toastBorderColor(type: ToastMessage["type"]) {
  switch (type) {
    case "success": return "var(--color-success)";
    case "error":   return "var(--color-danger)";
    case "warning": return "var(--color-warning)";
    default:        return "var(--border-default)";
  }
}

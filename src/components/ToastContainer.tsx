// ============================================================================
// components/ToastContainer.tsx — 全局 Toast 通知
// ============================================================================
// 通过监听 "taglauncher-toast" CustomEvent 显示通知，无需 props 传递。
// mod JS 可以通过 window.__tagLauncherModApi.notify() 触发。
// 应用内部也可以 import { showToast } from "./ToastContainer" 调用。
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { showToast, type ToastType } from "../lib/toast";

export interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

// 按类型区分驻留时长：错误/警告承载"需要用户处理"的信息，给足阅读时间。
const TOAST_DURATION: Record<ToastType, number> = {
  info: 3500,
  success: 3500,
  warning: 5000,
  error: 7000,
};

// 兼容既有 `import { showToast } from "./ToastContainer"` 的调用点，统一转发到 lib/toast。
export { showToast };

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
    };
    window.addEventListener("taglauncher-toast", handler);
    return () => window.removeEventListener("taglauncher-toast", handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none" style={{ zIndex: "var(--z-toast)" as unknown as number }}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

/**
 * 单条 toast：自动关闭计时随悬停暂停（鼠标移入代表正在阅读，
 * 移出后按剩余时间继续），卸载时清理计时器。
 */
function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remainingRef = useRef(TOAST_DURATION[toast.type] ?? 3500);
  const startedAtRef = useRef(0);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const pause = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
  }, []);

  const resume = useCallback(() => {
    if (timerRef.current !== undefined) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      onDismissRef.current(toast.id);
    }, remainingRef.current);
  }, [toast.id]);

  useEffect(() => {
    resume();
    return pause;
  }, [resume, pause]);

  return (
    <div
      className="toast-enter pointer-events-auto flex items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-sm max-w-sm"
      onMouseEnter={pause}
      onMouseLeave={resume}
      role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
      style={{
        backgroundColor: "color-mix(in srgb, var(--bg-elevated) 96%, white)",
        borderColor: toastBorderColor(toast.type),
        boxShadow: "var(--shadow-overlay)",
        color: "var(--text-primary)",
      }}
    >
      <span style={{ color: toastIconColor(toast.type), flexShrink: 0 }}>
        {toastIcon(toast.type)}
      </span>
      <span className="flex-1 line-clamp-2 break-words">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-full)] opacity-50 transition-opacity hover:bg-[var(--bg-hover)] hover:opacity-100"
        style={{ color: "var(--text-muted)" }}
        title="关闭通知"
      >
        ✕
      </button>
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

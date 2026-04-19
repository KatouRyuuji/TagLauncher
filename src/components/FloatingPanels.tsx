// ============================================================================
// components/FloatingPanels.tsx — 浮动/模态 Mod Panel 容器
// ============================================================================
// 通过 ReactDOM.createPortal 渲染到 document.body，
// 管理 floating（可拖拽/调整大小）和 modal（全屏遮罩）两种面板。
// 不管理 sidebar 面板（Sidebar.tsx 负责）。
// ============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { PanelDescriptor, ModalButton } from "../types/panel";
import {
  PANEL_CREATE, PANEL_DESTROY, PANEL_SHOW, PANEL_HIDE, PANEL_TITLE,
  resolvePanel, firePanelEvent,
} from "../lib/panelRegistry";

export function FloatingPanels() {
  const [panels, setPanels] = useState<PanelDescriptor[]>([]);
  // 点击置顶：panelId → 序号（越大越靠前）
  const [zOrder, setZOrder] = useState<Record<string, number>>({});
  const zCounter = useRef(0);

  // ── 事件监听 ────────────────────────────────────────────────────────────

  useEffect(() => {
    const onPanelCreate = (e: Event) => {
      const desc = (e as CustomEvent<PanelDescriptor>).detail;
      if (desc.position !== "floating" && desc.position !== "modal") return;
      setPanels((prev) => {
        if (prev.some((p) => p.id === desc.id)) return prev;
        return [...prev, desc];
      });
      setZOrder((prev) => ({ ...prev, [desc.id]: ++zCounter.current }));
    };

    const onPanelDestroy = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setPanels((prev) => prev.filter((p) => p.id !== id));
      setZOrder((prev) => { const n = { ...prev }; delete n[id]; return n; });
    };

    const onPanelShow = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setPanels((prev) => prev.map((p) => p.id === id ? { ...p, visible: true } : p));
    };

    const onPanelHide = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setPanels((prev) => prev.map((p) => p.id === id ? { ...p, visible: false } : p));
    };

    const onPanelTitle = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setPanels((prev) => prev.map((p) => p.id === id ? { ...p, title } : p));
    };

    window.addEventListener(PANEL_CREATE, onPanelCreate);
    window.addEventListener(PANEL_DESTROY, onPanelDestroy);
    window.addEventListener(PANEL_SHOW, onPanelShow);
    window.addEventListener(PANEL_HIDE, onPanelHide);
    window.addEventListener(PANEL_TITLE, onPanelTitle);

    return () => {
      window.removeEventListener(PANEL_CREATE, onPanelCreate);
      window.removeEventListener(PANEL_DESTROY, onPanelDestroy);
      window.removeEventListener(PANEL_SHOW, onPanelShow);
      window.removeEventListener(PANEL_HIDE, onPanelHide);
      window.removeEventListener(PANEL_TITLE, onPanelTitle);
    };
  }, []);

  const bringToFront = useCallback((id: string) => {
    setZOrder((prev) => ({ ...prev, [id]: ++zCounter.current }));
  }, []);

  if (panels.length === 0) return null;

  return createPortal(
    <>
      {panels.map((panel) => {
        if (panel.position === "floating") {
          return (
            <FloatingPanel
              key={panel.id}
              panel={panel}
              zSerial={zOrder[panel.id] ?? 0}
              onBringToFront={() => bringToFront(panel.id)}
            />
          );
        }
        if (panel.position === "modal") {
          return (
            <ModalPanel
              key={panel.id}
              panel={panel}
            />
          );
        }
        return null;
      })}
    </>,
    document.body,
  );
}

// ── 浮动面板 ─────────────────────────────────────────────────────────────

interface FloatingPanelProps {
  panel: PanelDescriptor;
  zSerial: number;
  onBringToFront: () => void;
}

function FloatingPanel({ panel, zSerial, onBringToFront }: FloatingPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resolved = useRef(false);

  // 初次挂载时 resolve PanelHandle
  useEffect(() => {
    if (!resolved.current && contentRef.current) {
      resolved.current = true;
      resolvePanel(panel.id, contentRef.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 拖拽标题栏移动浮动面板（直接操作 DOM，避免频繁 setState）
  const handleTitleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    onBringToFront();

    const el = wrapperRef.current;
    if (!el) return;

    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;

    const onMove = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ev.clientX - startX));
      const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, ev.clientY - startY));
      el.style.left = x + "px";
      el.style.top  = y + "px";
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [onBringToFront]);

  // 调整大小（右下角 resize 句柄）
  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const el = wrapperRef.current;
    if (!el) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;

    const minW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel-floating-min-width")) || 200;
    const minH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel-floating-min-height")) || 150;

    const onMove = (ev: MouseEvent) => {
      const w = Math.max(minW, startW + ev.clientX - startX);
      const h = Math.max(minH, startH + ev.clientY - startY);
      el.style.width  = w + "px";
      el.style.height = h + "px";
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // z-index = 基础层(CSS var) + 序号（最大 49，不超过 settings-overlay 200）
  const zIndexBase = "var(--z-floating-panel)";

  if (!panel.visible) return null;

  return (
    <div
      ref={wrapperRef}
      className="mod-panel-floating"
      style={{
        left:   panel.x,
        top:    panel.y,
        width:  panel.width,
        height: panel.height,
        zIndex: `calc(${zIndexBase} + ${Math.min(zSerial, 49)})` as unknown as number,
      }}
      onMouseDown={onBringToFront}
    >
      {/* 标题栏 */}
      <div
        className="mod-panel-titlebar"
        onMouseDown={handleTitleMouseDown}
      >
        <span
          className="flex-1 text-xs font-medium truncate"
          style={{ color: "var(--text-secondary)" }}
        >
          {panel.title}
        </span>
        <button
          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] transition-colors"
          style={{ color: "var(--text-muted)", cursor: "pointer" }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => firePanelEvent(panel.id, "close")}
          title="关闭"
        >
          ✕
        </button>
      </div>

      {/* 内容容器（mod 填充） */}
      <div
        ref={contentRef}
        className="mod-panel-body"
        style={{ color: "var(--text-primary)", fontSize: "var(--font-size-sm)" }}
      />

      {/* Resize 句柄 */}
      {panel.resizable && (
        <div
          className="mod-panel-resize-handle"
          style={{ opacity: 0.3, color: "var(--text-muted)" }}
          onMouseDown={handleResizeMouseDown}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}

// ── 模态面板 ─────────────────────────────────────────────────────────────

interface ModalPanelProps {
  panel: PanelDescriptor;
}

function ModalPanel({ panel }: ModalPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const resolved = useRef(false);

  useEffect(() => {
    if (!resolved.current && contentRef.current) {
      resolved.current = true;
      resolvePanel(panel.id, contentRef.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!panel.visible) return null;

  // modal 使用 settings-overlay 之下（-5），避免覆盖系统模态
  const overlayZ = `calc(var(--z-settings-overlay) - 5)` as unknown as number;
  const panelZ   = `calc(var(--z-settings-panel) - 5)` as unknown as number;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: overlayZ }}
        onClick={() => firePanelEvent(panel.id, "close")}
      />
      {/* 内容区 */}
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none"
        style={{ zIndex: panelZ }}
      >
        <div
          className="modal-surface pointer-events-auto overflow-hidden flex flex-col"
          style={{
            width:  panel.width  || 480,
            maxWidth:  "90vw",
            maxHeight: "80vh",
          }}
        >
          {/* 标题栏 */}
          <div
            className="mod-panel-titlebar"
            style={{ cursor: "default" }}
          >
            <span
              className="flex-1 text-sm font-medium truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {panel.title}
            </span>
            <button
              className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: "var(--text-muted)", cursor: "pointer" }}
              onClick={() => firePanelEvent(panel.id, "close")}
              title="关闭"
            >
              ✕
            </button>
          </div>

          {/* 内容容器（mod 填充） */}
          <div
            ref={contentRef}
            className="flex-1 overflow-auto p-4"
            style={{ color: "var(--text-primary)", fontSize: "var(--font-size-sm)" }}
          />

          {/* 按钮栏（可选） */}
          {panel.modalButtons.length > 0 && (
            <div
              className="flex justify-end gap-2 px-4 py-3 border-t"
              style={{ borderColor: "var(--panel-border-color)" }}
            >
              {panel.modalButtons.map((btn: ModalButton, i: number) => (
                <button
                  key={i}
                  onClick={() => {
                    if (btn.action === "confirm") {
                      firePanelEvent(panel.id, "modal-confirm");
                    } else if (btn.action === "cancel") {
                      firePanelEvent(panel.id, "modal-cancel");
                      firePanelEvent(panel.id, "close");
                    } else {
                      firePanelEvent(panel.id, "modal-button", btn.id);
                    }
                  }}
                  className={btn.action === "confirm" ? "action-button action-button-primary min-h-[34px] px-3 text-xs" : "action-button min-h-[34px] px-3 text-xs"}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

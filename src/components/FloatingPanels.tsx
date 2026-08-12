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
  resolvePanel, firePanelEvent, destroyPanel,
} from "../lib/panelRegistry";

/**
 * 面板 × 按钮/遮罩的统一关闭行为：
 * destroyPanel 内部统一派发 close 事件并清理/卸载，mod 若在 close 监听里
 * 已自行 close()，这里的调用因重入守卫成为 no-op，不会重复派发。
 */
function requestClosePanel(fullId: string): void {
  destroyPanel(fullId);
}

/** z 序号归一化阈值：超过后把现存序号按相对顺序重排回小区间 */
const Z_NORMALIZE_THRESHOLD = 1000;

/**
 * 给目标面板分配最高 z 序号。纯函数（供 setState updater 使用）：
 * 直接取现存最大值 +1，不依赖 ref 计数器；超过阈值时按相对顺序归一化重排，
 * 避免序号无限增长后被渲染端 min(serial, 49) 钳制成同一 z-index、置顶失效。
 */
function assignTopZ(prev: Record<string, number>, id: string): Record<string, number> {
  const values = Object.values(prev);
  const next = (values.length > 0 ? Math.max(...values) : 0) + 1;
  if (next <= Z_NORMALIZE_THRESHOLD) {
    return { ...prev, [id]: next };
  }
  const sorted = Object.entries(prev)
    .filter(([key]) => key !== id)
    .sort((a, b) => a[1] - b[1]);
  const normalized: Record<string, number> = {};
  sorted.forEach(([key], index) => {
    normalized[key] = index + 1;
  });
  normalized[id] = sorted.length + 1;
  return normalized;
}

/**
 * 解析 px 单位的 CSS 变量为数值。非 px 单位（rem/% 等）或非法值回退默认值——
 * parseInt("10rem") 会得到 10，把最小宽度错当成 10px。
 */
function parsePxCssVar(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!/^\d+(\.\d+)?(px)?$/.test(raw)) return fallback;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function FloatingPanels() {
  const [panels, setPanels] = useState<PanelDescriptor[]>([]);
  // 点击置顶：panelId → 序号（越大越靠前）
  const [zOrder, setZOrder] = useState<Record<string, number>>({});

  // ── 事件监听 ────────────────────────────────────────────────────────────

  useEffect(() => {
    const onPanelCreate = (e: Event) => {
      const desc = (e as CustomEvent<PanelDescriptor>).detail;
      if (desc.position !== "floating" && desc.position !== "modal") return;
      setPanels((prev) => {
        if (prev.some((p) => p.id === desc.id)) return prev;
        return [...prev, desc];
      });
      setZOrder((prev) => assignTopZ(prev, desc.id));
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
    setZOrder((prev) => assignTopZ(prev, id));
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

  // 初次挂载时 resolve PanelHandle；面板隐藏时保持容器常驻，仅 CSS 隐藏
  useEffect(() => {
    if (contentRef.current) {
      resolvePanel(panel.id, contentRef.current);
    }
  }, [panel.id]);

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

    const minW = parsePxCssVar("--panel-floating-min-width", 200);
    const minH = parsePxCssVar("--panel-floating-min-height", 150);

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
        display: panel.visible ? undefined : "none",
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
          onClick={() => requestClosePanel(panel.id)}
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

  // visible=false 时下方 return null 会卸载容器 div，再次 show 时挂载的是全新 div。
  // 因此不能只在首次挂载 resolve 一次：每次渲染后都幂等调用 resolvePanel——
  // 对已 resolve 的面板它只更新 handle.container 引用（见 panelRegistry），
  // 保证 mod 的 hide→show 循环后 handle.container 始终指向当前真实 DOM。
  useEffect(() => {
    if (contentRef.current) {
      resolvePanel(panel.id, contentRef.current);
    }
  });

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
        onClick={() => requestClosePanel(panel.id)}
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
              onClick={() => requestClosePanel(panel.id)}
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
                      requestClosePanel(panel.id);
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

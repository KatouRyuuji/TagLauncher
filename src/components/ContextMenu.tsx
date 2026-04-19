import { useState, useRef, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ItemWithTags, Cabinet } from "../types";
import * as db from "../lib/db";

interface ContextMenuProps {
  item: ItemWithTags;
  cabinets: Cabinet[];
  currentCabinetId: number | null;
  currentCabinetName: string | null;
  position: { x: number; y: number };
  onClose: () => void;
  onLaunch: () => void;
  onRemove: () => void;
  onEditTags: () => void;
  onToggleFavorite: () => void;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onRemoveItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onUpdateThumbnail: (itemId: number, iconPath: string | null) => Promise<void>;
}

export function ContextMenu({
  item,
  cabinets,
  currentCabinetId,
  currentCabinetName,
  position,
  onClose,
  onLaunch,
  onRemove,
  onEditTags,
  onToggleFavorite,
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onUpdateThumbnail,
}: ContextMenuProps) {
  const [showCabinetSub, setShowCabinetSub] = useState(false);
  const [submenuToLeft, setSubmenuToLeft] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cabinetTriggerRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuHideTimerRef = useRef<number | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: position.x,
    top: position.y,
    zIndex: "var(--z-context-menu)" as unknown as number,
  });
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: -9999,
    top: -9999,
    zIndex: "var(--z-context-submenu)" as unknown as number,
  });

  const updateMenuPosition = useCallback(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const gap = 8;
    const subMenuWidth = 160;
    const rect = menuEl.getBoundingClientRect();
    const nextLeft = Math.min(
      Math.max(gap, position.x),
      Math.max(gap, window.innerWidth - rect.width - gap),
    );
    const nextTop = Math.min(
      Math.max(gap, position.y),
      Math.max(gap, window.innerHeight - rect.height - gap),
    );

    setStyle({
      position: "fixed",
      left: nextLeft,
      top: nextTop,
      zIndex: "var(--z-context-menu)" as unknown as number,
    });

    const rightSpace = window.innerWidth - (nextLeft + rect.width);
    const leftSpace = nextLeft - gap;
    setSubmenuToLeft(rightSpace < subMenuWidth + gap && leftSpace > rightSpace);
  }, [position.x, position.y]);

  const clearSubmenuHideTimer = useCallback(() => {
    if (submenuHideTimerRef.current !== null) {
      window.clearTimeout(submenuHideTimerRef.current);
      submenuHideTimerRef.current = null;
    }
  }, []);

  const openCabinetSubmenu = useCallback(() => {
    clearSubmenuHideTimer();
    setShowCabinetSub(true);
  }, [clearSubmenuHideTimer]);

  const scheduleCloseCabinetSubmenu = useCallback(() => {
    clearSubmenuHideTimer();
    submenuHideTimerRef.current = window.setTimeout(() => {
      setShowCabinetSub(false);
    }, 120);
  }, [clearSubmenuHideTimer]);

  const updateSubmenuPosition = useCallback(() => {
    const triggerEl = cabinetTriggerRef.current;
    if (!triggerEl) return;

    const viewportGap = 8;
    const gap = 6;
    const fallbackWidth = 180;
    const fallbackHeight = Math.min(280, cabinets.length * 30 + 16);
    const rect = triggerEl.getBoundingClientRect();
    const panelWidth = submenuRef.current?.offsetWidth ?? fallbackWidth;
    const panelHeight = submenuRef.current?.offsetHeight ?? fallbackHeight;

    const placeLeft =
      rect.right + gap + panelWidth > window.innerWidth - viewportGap &&
      rect.left - gap - panelWidth >= viewportGap;

    const left = placeLeft
      ? Math.max(viewportGap, rect.left - panelWidth - gap)
      : Math.min(window.innerWidth - panelWidth - viewportGap, rect.right + gap);

    const top = Math.min(
      Math.max(viewportGap, rect.top - 4),
      Math.max(viewportGap, window.innerHeight - panelHeight - viewportGap),
    );

    setSubmenuToLeft(placeLeft);
    setSubmenuStyle({
      position: "fixed",
      left,
      top,
      zIndex: "var(--z-context-submenu)" as unknown as number,
    });
  }, [cabinets.length]);

  useEffect(() => {
    setStyle({
      position: "fixed",
      left: position.x,
      top: position.y,
      zIndex: "var(--z-context-menu)" as unknown as number,
    });
    const id = window.requestAnimationFrame(updateMenuPosition);
    return () => window.cancelAnimationFrame(id);
  }, [position.x, position.y, updateMenuPosition, showCabinetSub, cabinets.length]);

  useEffect(() => {
    const handleResize = () => { updateMenuPosition(); };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateMenuPosition]);

  useEffect(() => {
    if (!showCabinetSub) return;

    const handleViewportChange = () => { updateSubmenuPosition(); };
    const frameId = window.requestAnimationFrame(updateSubmenuPosition);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [showCabinetSub, updateSubmenuPosition]);

  useEffect(() => () => clearSubmenuHideTimer(), [clearSubmenuHideTimer]);

  const handleOpenFolder = async () => {
    await db.openInExplorer(item.path);
    onClose();
  };

  const handleChangeThumbnail = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic", "heif"],
        },
      ],
    });
    if (!selected || Array.isArray(selected)) return;
    await onUpdateThumbnail(item.id, selected);
    onClose();
  };

  const handleClearThumbnail = async () => {
    await onUpdateThumbnail(item.id, null);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: "var(--z-context-overlay)" as unknown as number }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />

      <div ref={menuRef} style={{ ...style, boxShadow: 'var(--shadow-dropdown)' }} className="bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded-[var(--radius-md)] py-0.5 w-[168px] max-w-[46vw] max-h-[70vh] overflow-y-auto text-[13px]">
        <button onClick={() => { onLaunch(); onClose(); }} className="w-full text-left px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          打开
        </button>
        <button onClick={handleOpenFolder} className="w-full text-left px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          打开所在文件夹
        </button>
        <button onClick={handleChangeThumbnail} className="w-full text-left px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          {item.icon_path ? "更换缩略图" : "设置缩略图"}
        </button>
        {item.icon_path && (
          <button onClick={handleClearThumbnail} className="w-full text-left px-2.5 py-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
            清除缩略图
          </button>
        )}
        <div className="h-px bg-[var(--border-subtle)] my-0.5" />

        <button onClick={() => { onToggleFavorite(); onClose(); }} className="w-full text-left px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
          {item.is_favorite ? (
            <>
              <svg className="w-3.5 h-3.5" style={{ color: "var(--color-favorite)" }} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              取消收藏
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              收藏
            </>
          )}
        </button>

        <button onClick={() => { onEditTags(); onClose(); }} className="w-full text-left px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          管理标签
        </button>

        {cabinets.length > 0 && (
          <div onMouseEnter={openCabinetSubmenu} onMouseLeave={scheduleCloseCabinetSubmenu}>
            <button
              ref={cabinetTriggerRef}
              className="w-full text-left px-2.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-between"
            >
              添加到文件柜
              <svg className={`w-3 h-3 text-[var(--text-faint)] transition-transform ${submenuToLeft ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {currentCabinetId !== null && (
          <button
            onClick={async () => {
              await onRemoveItemFromCabinet(currentCabinetId, item.id);
              onClose();
            }}
            className="w-full text-left px-2.5 py-1 text-[var(--color-warning)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-warning)] transition-colors"
          >
            {currentCabinetName ? `从当前文件柜移除: ${currentCabinetName}` : "从当前文件柜移除"}
          </button>
        )}

        <div className="h-px bg-[var(--border-subtle)] my-0.5" />
        <button onClick={() => { onRemove(); onClose(); }} className="w-full text-left px-2.5 py-1 text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-hover)] transition-colors">
          删除
        </button>
      </div>

      {showCabinetSub && (
        <div
          ref={submenuRef}
          style={{ ...submenuStyle, boxShadow: 'var(--shadow-dropdown)' }}
          onMouseEnter={openCabinetSubmenu}
          onMouseLeave={scheduleCloseCabinetSubmenu}
          className="bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded-[var(--radius-md)] py-0.5 w-[180px] max-w-[42vw] max-h-[60vh] overflow-y-auto"
        >
          {cabinets.map((cab) => (
            <button
              key={cab.id}
              onClick={async () => {
                await onAddItemToCabinet(cab.id, item.id);
                onClose();
              }}
              className="w-full text-left px-2.5 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cab.color }} />
              <span className="truncate">{cab.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

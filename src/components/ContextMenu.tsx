import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as db from "../lib/db";
import type { Cabinet, ItemWithTags } from "../types";

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
    const subMenuWidth = 196;
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
    const gap = 8;
    const fallbackWidth = 196;
    const fallbackHeight = Math.min(320, cabinets.length * 40 + 20);
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
      Math.max(viewportGap, rect.top - 6),
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
    const handleResize = () => {
      updateMenuPosition();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateMenuPosition]);

  useEffect(() => {
    if (!showCabinetSub) return;

    const handleViewportChange = () => {
      updateSubmenuPosition();
    };
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
      <div
        className="fixed inset-0"
        style={{ zIndex: "var(--z-context-overlay)" as unknown as number }}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />

      <div
        ref={menuRef}
        style={{ ...style, boxShadow: "var(--shadow-dropdown)" }}
        className="modal-surface w-[196px] max-h-[72vh] max-w-[46vw] overflow-y-auto p-2"
      >
        <MenuItem label="打开" onClick={() => { onLaunch(); onClose(); }} />
        <MenuItem label="打开所在文件夹" onClick={() => void handleOpenFolder()} />
        <MenuItem label={item.icon_path ? "更换缩略图" : "设置缩略图"} onClick={() => void handleChangeThumbnail()} />
        {item.icon_path && <MenuItem label="清除缩略图" onClick={() => void handleClearThumbnail()} />}
        <MenuDivider />

        <MenuItem
          label={item.is_favorite ? "取消收藏" : "加入收藏"}
          onClick={() => { onToggleFavorite(); onClose(); }}
          accent={item.is_favorite ? "favorite" : undefined}
        />
        <MenuItem label="管理标签" onClick={() => { onEditTags(); onClose(); }} />

        {cabinets.length > 0 && (
          <div onMouseEnter={openCabinetSubmenu} onMouseLeave={scheduleCloseCabinetSubmenu}>
            <button
              ref={cabinetTriggerRef}
              type="button"
              className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              添加到文件柜
              <svg
                className={`h-4 w-4 text-[var(--text-faint)] transition-transform ${submenuToLeft ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {currentCabinetId !== null && (
          <MenuItem
            label={currentCabinetName ? `移出文件柜 · ${currentCabinetName}` : "移出当前文件柜"}
            onClick={async () => {
              await onRemoveItemFromCabinet(currentCabinetId, item.id);
              onClose();
            }}
            accent="warning"
          />
        )}

        <MenuDivider />
        <MenuItem label="删除" onClick={() => { onRemove(); onClose(); }} accent="danger" />
      </div>

      {showCabinetSub && (
        <div
          ref={submenuRef}
          style={{ ...submenuStyle, boxShadow: "var(--shadow-dropdown)" }}
          onMouseEnter={openCabinetSubmenu}
          onMouseLeave={scheduleCloseCabinetSubmenu}
          className="modal-surface w-[196px] max-h-[60vh] max-w-[42vw] overflow-y-auto p-2"
        >
          {cabinets.map((cabinet) => (
            <button
              key={cabinet.id}
              type="button"
              onClick={async () => {
                await onAddItemToCabinet(cabinet.id, item.id);
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ backgroundColor: cabinet.color }} />
              <span className="truncate">{cabinet.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MenuItem({
  label,
  onClick,
  accent,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  accent?: "danger" | "warning" | "favorite";
}) {
  const accentMap = {
    danger: {
      color: "var(--color-danger)",
      hoverBg: "var(--color-danger-bg)",
    },
    warning: {
      color: "var(--color-warning)",
      hoverBg: "var(--status-warning-bg)",
    },
    favorite: {
      color: "var(--color-favorite)",
      hoverBg: "color-mix(in srgb, var(--color-favorite) 14%, transparent)",
    },
  } as const;

  const accentStyle = accent ? accentMap[accent] : null;

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-sm hover:text-[var(--text-primary)]"
      style={{
        color: accentStyle?.color ?? "var(--text-secondary)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.backgroundColor = accentStyle?.hoverBg ?? "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = "";
      }}
    >
      {label}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-[var(--border-subtle)]" />;
}

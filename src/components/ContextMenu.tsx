import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { stepMenuIndex } from "../lib/itemQuery";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";
import { copyText } from "../lib/clipboard";
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
  onPreview?: () => void;
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
  onPreview,
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onUpdateThumbnail,
}: ContextMenuProps) {
  const [showCabinetSub, setShowCabinetSub] = useState(false);
  const [submenuToLeft, setSubmenuToLeft] = useState(false);
  const menuRef = useFocusTrap<HTMLDivElement>({ active: true });
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

  const showCabinetSubRef = useRef(showCabinetSub);
  showCabinetSubRef.current = showCabinetSub;
  const focusSubmenuOnOpenRef = useRef(false);

  const handleEscape = useCallback(() => {
    if (showCabinetSubRef.current) {
      setShowCabinetSub(false);
      cabinetTriggerRef.current?.focus();
      return;
    }
    onClose();
  }, [onClose]);

  useEscapeKey(handleEscape);

  useEffect(() => {
    if (!showCabinetSub || !focusSubmenuOnOpenRef.current) return;
    focusSubmenuOnOpenRef.current = false;
    submenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [showCabinetSub]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const menu = menuRef.current;
      if (!menu) return;

      const submenu = submenuRef.current;
      const active = event.target instanceof HTMLElement ? event.target : null;
      const inSubmenu = Boolean(submenu && active && submenu.contains(active));
      const container = inSubmenu && submenu ? submenu : menu;

      if (event.key === "ArrowRight" && !inSubmenu && cabinetTriggerRef.current) {
        const trigger = cabinetTriggerRef.current;
        if (active === trigger || (active !== null && trigger.contains(active))) {
          event.preventDefault();
          focusSubmenuOnOpenRef.current = true;
          openCabinetSubmenu();
          return;
        }
      }

      if (event.key === "ArrowLeft" && inSubmenu) {
        event.preventDefault();
        setShowCabinetSub(false);
        cabinetTriggerRef.current?.focus();
        return;
      }

      const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const current = items.findIndex((el) => el === active || (active !== null && el.contains(active)));
      const next = stepMenuIndex(items.length, current, event.key);
      if (next == null) return;
      event.preventDefault();
      items[next]?.focus();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCabinetSubmenu]);

  const handleOpenFolder = async () => {
    // 按 id 打开：后端会先按文件ID重定位到当前真实路径，避免对象被移动后打开失败
    try {
      await db.openInExplorerById(item.id);
    } catch (e) {
      // 对象已丢失/无法定位时给出明确反馈，避免"点了没反应"
      const detail = e instanceof Error ? e.message : String(e);
      showToast(`打开所在文件夹失败：${detail}`, "error");
    } finally {
      onClose();
    }
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

  // 通过 Portal 渲染到 body：彻底免疫祖先的 transform / will-change / overflow，
  // 保证 position:fixed 始终相对视口定位（虚拟化列表内右键也精准跟随鼠标）。
  return createPortal(
    <>
      <div
        data-context-menu=""
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ zIndex: "var(--z-context-overlay)" as unknown as number }}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          const x = event.clientX;
          const y = event.clientY;
          onClose();
          // 遮罩关掉后把右键转发给下层对象，才能直接在另一项上打开新菜单。
          requestAnimationFrame(() => {
            const under = document.elementFromPoint(x, y);
            if (!(under instanceof Element) || under.closest("[data-context-menu]")) return;
            under.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 2,
              }),
            );
          });
        }}
      />

      <div
        ref={menuRef}
        data-context-menu=""
        role="menu"
        style={{ ...style, boxShadow: "var(--shadow-dropdown)" }}
        className="modal-surface w-[196px] max-h-[72vh] max-w-[46vw] overflow-y-auto p-2"
      >
        <MenuItem label="打开" onClick={() => { onLaunch(); onClose(); }} />
        {onPreview && <MenuItem label="快速预览" onClick={() => { onPreview(); onClose(); }} />}
        <MenuItem label="打开所在文件夹" onClick={() => void handleOpenFolder()} />
        <MenuItem label="复制路径" onClick={() => { void copyText(item.path, "已复制路径"); onClose(); }} />
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
              role="menuitem"
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
              role="menuitem"
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
    </>,
    document.body,
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
      role="menuitem"
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

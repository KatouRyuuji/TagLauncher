
import { useState, useRef, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ItemWithTags, Tag, Cabinet } from "../types";
import { ItemTagsEditor } from "./ItemTagsEditor";
import * as db from "../lib/db";
import { useInternalDragStore } from "../stores/internalDragStore";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";


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

function ContextMenu({
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
    zIndex: 100,
  });
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: -9999,
    top: -9999,
    zIndex: 110,
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
      zIndex: 100,
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
      zIndex: 110,
    });
  }, [cabinets.length]);

  useEffect(() => {
    setStyle({
      position: "fixed",
      left: position.x,
      top: position.y,
      zIndex: 100,
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
    if (!showCabinetSub) {
      return;
    }

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
      <div className="fixed inset-0 z-[99]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />

      <div ref={menuRef} style={style} className="bg-[#1c1c1c] border border-white/[0.1] rounded-md shadow-2xl py-0.5 w-[168px] max-w-[46vw] max-h-[70vh] overflow-y-auto text-[13px]">
        <button onClick={() => { onLaunch(); onClose(); }} className="w-full text-left px-2.5 py-1 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors">
          打开
        </button>
        <button onClick={handleOpenFolder} className="w-full text-left px-2.5 py-1 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors">
          打开所在文件夹
        </button>
        <button onClick={handleChangeThumbnail} className="w-full text-left px-2.5 py-1 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors">
          {item.icon_path ? "更换缩略图" : "设置缩略图"}
        </button>
        {item.icon_path && (
          <button onClick={handleClearThumbnail} className="w-full text-left px-2.5 py-1 text-white/50 hover:bg-white/[0.06] hover:text-white transition-colors">
            清除缩略图
          </button>
        )}
        <div className="h-px bg-white/[0.06] my-0.5" />

        <button onClick={() => { onToggleFavorite(); onClose(); }} className="w-full text-left px-2.5 py-1 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors flex items-center gap-1.5">
          {item.is_favorite ? (
            <>
              <svg className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              取消收藏
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              收藏
            </>
          )}
        </button>

        <button onClick={() => { onEditTags(); onClose(); }} className="w-full text-left px-2.5 py-1 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors">
          管理标签
        </button>

        {cabinets.length > 0 && (
          <div onMouseEnter={openCabinetSubmenu} onMouseLeave={scheduleCloseCabinetSubmenu}>
            <button
              ref={cabinetTriggerRef}
              className="w-full text-left px-2.5 py-1 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors flex items-center justify-between"
            >
              添加到文件柜
              <svg className={`w-3 h-3 text-white/30 transition-transform ${submenuToLeft ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            className="w-full text-left px-2.5 py-1 text-orange-300/80 hover:bg-orange-500/10 hover:text-orange-200 transition-colors"
          >
            {currentCabinetName ? `从当前文件柜移除: ${currentCabinetName}` : "从当前文件柜移除"}
          </button>
        )}

        <div className="h-px bg-white/[0.06] my-0.5" />
        <button onClick={() => { onRemove(); onClose(); }} className="w-full text-left px-2.5 py-1 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors">
          删除
        </button>
      </div>

      {showCabinetSub && (
        <div
          ref={submenuRef}
          style={submenuStyle}
          onMouseEnter={openCabinetSubmenu}
          onMouseLeave={scheduleCloseCabinetSubmenu}
          className="bg-[#1c1c1c] border border-white/[0.1] rounded-md shadow-2xl py-0.5 w-[180px] max-w-[42vw] max-h-[60vh] overflow-y-auto"
        >
          {cabinets.map((cab) => (
            <button
              key={cab.id}
              onClick={async () => {
                await onAddItemToCabinet(cab.id, item.id);
                onClose();
              }}
              className="w-full text-left px-2.5 py-1.5 text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors flex items-center gap-1.5"
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


const TYPE_ICONS: Record<string, string> = {
  folder: "📁",
  image: "🖼️",
  exe: "⚙️",
  bat: "📜",
  ps1: "🔧",
};

const TYPE_LABELS: Record<string, string> = {
  folder: "文件夹",
  image: "图片",
  exe: "应用程序",
  bat: "批处理",
  ps1: "PowerShell",
};

function getTypeLabel(itemType: string): string {
  return TYPE_LABELS[itemType] || itemType;
}

function getFileSuffix(item: ItemWithTags): string {
  if (item.type === "folder") return "无后缀";
  const name = item.name || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "无后缀";
  return name.slice(dot).toLowerCase();
}

function FavoriteStar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <svg className="w-3.5 h-3.5 text-yellow-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  );
}

function ItemDragHandle({
  onPointerDown,
  className = "",
}: {
  onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => void;
  className?: string;
}) {
  return (
    <span
      data-item-drag="true"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-white/28 hover:text-white/65 hover:bg-white/[0.05] cursor-grab active:cursor-grabbing ${className}`}
      title="拖拽到文件柜"
      aria-label="拖拽到文件柜"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M6 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM6 12a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
      </svg>
    </span>
  );
}

function ItemVisualIcon({ item, emojiClass, imageClass }: { item: ItemWithTags; emojiClass: string; imageClass: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconPath = item.icon_path?.trim();

  useEffect(() => {
    setImageFailed(false);
  }, [iconPath]);

  if (iconPath && !imageFailed) {
    const normalizedPath = iconPath.replace(/\\/g, "/");
    return (
      <img
        src={convertFileSrc(normalizedPath)}
        alt={`${item.name} 缩略图`}
        className={imageClass}
        onError={() => setImageFailed(true)}
        draggable={false}
      />
    );
  }
  return <span className={emojiClass}>{TYPE_ICONS[item.type] || "📄"}</span>;
}


interface DraggableTagListProps {
  item: ItemWithTags;
  onReorder: (itemId: number, newTagIds: number[]) => Promise<void>;
  onRemoveTag: (itemId: number, tagId: number) => Promise<void>;
  compact?: boolean;
}

function DraggableTagList({ item, onReorder, onRemoveTag, compact }: DraggableTagListProps) {
  const activeDrag = useInternalDragStore((state) => state.drag);
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  const dragIdx =
    activeDrag?.kind === "reorder-tag" && activeDrag.itemId === item.id
      ? activeDrag.sourceIdx
      : null;
  const overIdx =
    hoverTarget?.kind === "reorder-tag" && hoverTarget.itemId === item.id
      ? hoverTarget.targetIdx
      : null;
  const removeZoneActive =
    hoverTarget?.kind === "reorder-remove" && hoverTarget.itemId === item.id;

  const handleTagPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    idx: number,
  ) => {
    const tag = item.tags[idx];
    if (!tag) {
      return;
    }

    beginInternalPointerDrag({
      event,
      payload: {
        kind: "reorder-tag",
        itemId: item.id,
        sourceIdx: idx,
        tagId: tag.id,
        label: tag.name,
        color: tag.color,
        tagIds: item.tags.map((itemTag) => itemTag.id),
      },
      findHoverTarget: (pointerEvent) => {
        const removeItemId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-reorder-remove-item-id]",
          "reorderRemoveItemId",
        );
        if (removeItemId === item.id) {
          return { kind: "reorder-remove", itemId: item.id };
        }

        const targetItemId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-reorder-tag-item-id]",
          "reorderTagItemId",
        );
        const targetIdx = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-reorder-tag-idx]",
          "reorderTagIdx",
        );
        if (targetItemId === item.id && targetIdx !== null) {
          return { kind: "reorder-tag", itemId: item.id, targetIdx };
        }

        return null;
      },
      onDrop: async (target) => {
        if (target?.kind === "reorder-remove" && target.itemId === item.id) {
          await onRemoveTag(item.id, tag.id);
          return;
        }

        if (target?.kind !== "reorder-tag" || target.itemId !== item.id || target.targetIdx === idx) {
          return;
        }

        const tagIds = item.tags.map((itemTag) => itemTag.id);
        const [moved] = tagIds.splice(idx, 1);
        tagIds.splice(target.targetIdx, 0, moved);
        await onReorder(item.id, tagIds);
      },
    });
  };

  if (item.tags.length === 0) return null;

  return (
    <div
      data-tag-drag="true"
      className={`flex flex-wrap gap-1 ${compact ? "" : ""}`}
    >
      {item.tags.map((tag, idx) => (
        <span
          key={tag.id}
          data-tag-drag="true"
          data-reorder-tag-item-id={item.id}
          data-reorder-tag-idx={idx}
          onPointerDown={(event) => handleTagPointerDown(event, idx)}
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full cursor-grab active:cursor-grabbing transition-all group/tag ${
            dragIdx === idx ? "opacity-40" : ""
          } ${overIdx === idx && dragIdx !== null && dragIdx !== idx ? "ring-1 ring-blue-400/50" : ""}`}
          style={{ backgroundColor: tag.color + "33", color: tag.color }}
        >
          {tag.name}
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void onRemoveTag(item.id, tag.id); }}
            className="ml-0.5 opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto hover:text-white transition-opacity"
          >
            ×
          </button>
        </span>
      ))}
      {dragIdx !== null && (
        <span
          data-reorder-remove-item-id={item.id}
          className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border border-dashed transition-all ${
            removeZoneActive
              ? "border-red-400/60 bg-red-500/15 text-red-400"
              : "border-white/15 text-white/25"
          }`}
        >
          拖拽到此移除
        </span>
      )}
    </div>
  );
}


interface ItemCardProps {
  item: ItemWithTags;
  tags: Tag[];
  cabinets: Cabinet[];
  currentCabinetId: number | null;
  onLaunch: () => void;
  onRemove: () => void;
  onAddTagToItem: (itemId: number, tagId: number) => Promise<void>;
  onRemoveTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  onAddNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  onSetTags: (itemId: number, tagIds: number[]) => Promise<void>;
  onToggleFavorite: () => void;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onRemoveItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onUpdateThumbnail: (itemId: number, iconPath: string | null) => Promise<void>;
}

export function ItemCard({
  item,
  tags,
  cabinets,
  currentCabinetId,
  onLaunch,
  onRemove,
  onRemoveTagFromItem,
  onAddNewTagToItem,
  onSetTags,
  onToggleFavorite,
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onUpdateThumbnail,
}: ItemCardProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const activeDrag = useInternalDragStore((state) => state.drag);
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cab) => cab.id === currentCabinetId)?.name ?? null;
  const tagDragOver =
    activeDrag?.kind === "tag" &&
    hoverTarget?.kind === "tag-item" &&
    hoverTarget.itemId === item.id;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleItemHandlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    beginInternalPointerDrag({
      event,
      payload: {
        kind: "item",
        itemId: item.id,
        label: item.name,
      },
      findHoverTarget: (pointerEvent) => {
        const favoriteTarget = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-favorite]",
          "dropItemFavorite",
        );
        if (favoriteTarget === 1) {
          return { kind: "item-favorites" };
        }

        const cabinetId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-cabinet-id]",
          "dropItemCabinetId",
        );
        return cabinetId === null ? null : { kind: "item-cabinet", cabinetId };
      },
      onDrop: async (target) => {
        if (target?.kind === "item-favorites") {
          if (!item.is_favorite) {
            await onToggleFavorite();
          }
          return;
        }

        if (target?.kind === "item-cabinet") {
          await onAddItemToCabinet(target.cabinetId, item.id);
        }
      },
    });
  };

  return (
    <>
      <div
        data-drop-tag-item-id={item.id}
        className={`bg-white/[0.02] border rounded-lg p-3 cursor-pointer hover:bg-white/[0.04] transition-all group ${
          tagDragOver ? "border-blue-500/50 bg-blue-500/5" : "border-white/[0.06] hover:border-white/[0.1]"
        }`}
        onDoubleClick={onLaunch}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => e.key === "Enter" && onLaunch()}
        tabIndex={0}
      >
        <div className="flex items-start justify-between mb-2 gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <ItemVisualIcon
              item={item}
              emojiClass="text-[28px]"
              imageClass="w-10 h-10 rounded-md object-cover border border-white/[0.08] bg-white/[0.03]"
            />
            <div className="min-w-0">
              <p className="text-[17px] text-white/55 truncate border-b border-white/[0.2] pb-0 leading-tight" title={getTypeLabel(item.type)}>
                {getTypeLabel(item.type)}
              </p>
              <p className="text-[16px] text-white/38 truncate border-b border-white/[0.14] pb-0 mt-0.5 leading-tight" title={getFileSuffix(item)}>
                {getFileSuffix(item)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ItemDragHandle onPointerDown={handleItemHandlePointerDown} />
            <FavoriteStar active={item.is_favorite} />
          </div>
        </div>
        <h3 className="text-white/90 text-sm font-medium truncate mb-0" title={item.name}>
          {item.name}
        </h3>
        <p className="text-[10px] text-white/25 truncate mb-1.5" title={item.path}>
          {item.path}
        </p>
        <DraggableTagList
          item={item}
          onReorder={onSetTags}
          onRemoveTag={onRemoveTagFromItem}
        />
      </div>

      {menuPos && (
        <ContextMenu
          item={item}
          cabinets={cabinets}
          currentCabinetId={currentCabinetId}
          currentCabinetName={currentCabinetName}
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onLaunch={onLaunch}
          onRemove={onRemove}
          onEditTags={() => setShowTagEditor(true)}
          onToggleFavorite={onToggleFavorite}
          onAddItemToCabinet={onAddItemToCabinet}
          onRemoveItemFromCabinet={onRemoveItemFromCabinet}
          onUpdateThumbnail={onUpdateThumbnail}
        />
      )}

      {showTagEditor && (
        <ItemTagsEditor
          item={item}
          tags={tags}
          onSave={async (tagIds) => { await onSetTags(item.id, tagIds); setShowTagEditor(false); }}
          onAddNewTag={async (name, baseTagIds) => onAddNewTagToItem(item.id, name, baseTagIds)}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </>
  );
}


export function ItemRow({
  item,
  tags,
  cabinets,
  currentCabinetId,
  onLaunch,
  onRemove,
  onRemoveTagFromItem,
  onAddNewTagToItem,
  onSetTags,
  onToggleFavorite,
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onUpdateThumbnail,
}: ItemCardProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const activeDrag = useInternalDragStore((state) => state.drag);
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cab) => cab.id === currentCabinetId)?.name ?? null;
  const tagDragOver =
    activeDrag?.kind === "tag" &&
    hoverTarget?.kind === "tag-item" &&
    hoverTarget.itemId === item.id;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleItemHandlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    beginInternalPointerDrag({
      event,
      payload: {
        kind: "item",
        itemId: item.id,
        label: item.name,
      },
      findHoverTarget: (pointerEvent) => {
        const favoriteTarget = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-favorite]",
          "dropItemFavorite",
        );
        if (favoriteTarget === 1) {
          return { kind: "item-favorites" };
        }

        const cabinetId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-item-cabinet-id]",
          "dropItemCabinetId",
        );
        return cabinetId === null ? null : { kind: "item-cabinet", cabinetId };
      },
      onDrop: async (target) => {
        if (target?.kind === "item-favorites") {
          if (!item.is_favorite) {
            await onToggleFavorite();
          }
          return;
        }

        if (target?.kind === "item-cabinet") {
          await onAddItemToCabinet(target.cabinetId, item.id);
        }
      },
    });
  };

  return (
    <>
      <div
        data-drop-tag-item-id={item.id}
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-all group border-b border-white/[0.03] ${
          tagDragOver ? "bg-blue-500/5" : ""
        }`}
        onDoubleClick={onLaunch}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => e.key === "Enter" && onLaunch()}
        tabIndex={0}
      >
        <ItemDragHandle onPointerDown={handleItemHandlePointerDown} className="h-5 w-5" />
        <FavoriteStar active={item.is_favorite} />
        <ItemVisualIcon
          item={item}
          emojiClass="text-xl shrink-0"
          imageClass="w-8 h-8 rounded-md object-cover border border-white/[0.08] bg-white/[0.03] shrink-0"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-white/90 text-sm truncate" title={item.name}>{item.name}</h3>
          <p className="text-[11px] text-white/20 truncate" title={item.path}>{item.path}</p>
        </div>
        <div className="shrink-0 max-w-[300px]">
          <DraggableTagList
            item={item}
            onReorder={onSetTags}
            onRemoveTag={onRemoveTagFromItem}
            compact
          />
        </div>
        <div className="shrink-0 w-24 text-right leading-tight">
          <p className="text-[17px] text-white/55 truncate border-b border-white/[0.2] pb-0.5" title={getTypeLabel(item.type)}>
            {getTypeLabel(item.type)}
          </p>
          <p className="text-[16px] text-white/38 truncate border-b border-white/[0.14] pb-0.5 mt-1" title={getFileSuffix(item)}>
            {getFileSuffix(item)}
          </p>
        </div>
      </div>

      {menuPos && (
        <ContextMenu
          item={item}
          cabinets={cabinets}
          currentCabinetId={currentCabinetId}
          currentCabinetName={currentCabinetName}
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onLaunch={onLaunch}
          onRemove={onRemove}
          onEditTags={() => setShowTagEditor(true)}
          onToggleFavorite={onToggleFavorite}
          onAddItemToCabinet={onAddItemToCabinet}
          onRemoveItemFromCabinet={onRemoveItemFromCabinet}
          onUpdateThumbnail={onUpdateThumbnail}
        />
      )}

      {showTagEditor && (
        <ItemTagsEditor
          item={item}
          tags={tags}
          onSave={async (tagIds) => { await onSetTags(item.id, tagIds); setShowTagEditor(false); }}
          onAddNewTag={async (name, baseTagIds) => onAddNewTagToItem(item.id, name, baseTagIds)}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </>
  );
}


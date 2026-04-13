import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import {
  shouldSuppressInternalDragClick,
  useInternalDragStore,
} from "../stores/internalDragStore";
import type { Tag, Cabinet } from "../types";
import { TagEditor } from "./TagEditor";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";

interface SidebarProps {
  tags: Tag[];
  cabinets: Cabinet[];
  onAddTag: (name: string, color: string) => Promise<unknown>;
  onUpdateTag: (id: number, name: string, color: string) => Promise<void>;
  onRemoveTag: (id: number) => Promise<void>;
  onAddCabinet: (name: string, color: string) => Promise<unknown>;
  onUpdateCabinet: (id: number, name: string, color: string) => Promise<void>;
  onRemoveCabinet: (id: number) => Promise<void>;
  onAddTagToItem: (itemId: number, tagId: number) => Promise<void>;
}

export function Sidebar({
  tags,
  cabinets,
  onAddTag,
  onUpdateTag,
  onRemoveTag,
  onAddCabinet,
  onUpdateCabinet,
  onRemoveCabinet,
  onAddTagToItem,
}: SidebarProps) {
  const {
    selectedTagIds,
    toggleTagSelection,
    setSelectedTagIds,
    selectedCabinetId,
    setSelectedCabinetId,
    sidebarTab,
    setSidebarTab,
    showFavorites,
    setShowFavorites,
  } = useAppStore();
  const activeDrag = useInternalDragStore((state) => state.drag);
  const hoverTarget = useInternalDragStore((state) => state.hoverTarget);

  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [showAddTag, setShowAddTag] = useState(false);
  const [editingCabinet, setEditingCabinet] = useState<Cabinet | null>(null);
  const [showAddCabinet, setShowAddCabinet] = useState(false);
  const visibleSection = activeDrag?.kind === "item" ? "cabinets" : sidebarTab;

  const hoveredCabinetId =
    activeDrag?.kind === "item" && hoverTarget?.kind === "item-cabinet"
      ? hoverTarget.cabinetId
      : null;
  const hoveredFavorites =
    activeDrag?.kind === "item" && hoverTarget?.kind === "item-favorites";

  const handleTagPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    tag: Tag,
  ) => {
    beginInternalPointerDrag({
      event,
      payload: {
        kind: "tag",
        tagId: tag.id,
        label: tag.name,
        color: tag.color,
      },
      findHoverTarget: (pointerEvent) => {
        const itemId = findClosestNumberDataAttribute(
          pointerEvent.clientX,
          pointerEvent.clientY,
          "[data-drop-tag-item-id]",
          "dropTagItemId",
        );
        return itemId === null ? null : { kind: "tag-item", itemId };
      },
      onDrop: async (target) => {
        if (target?.kind === "tag-item") {
          await onAddTagToItem(target.itemId, tag.id);
        }
      },
    });
  };

  const handleTagClick = (tagId: number) => {
    if (shouldSuppressInternalDragClick()) {
      return;
    }
    toggleTagSelection(tagId);
  };

  const handleCabinetClick = (cabinetId: number) => {
    if (shouldSuppressInternalDragClick()) {
      return;
    }
    setSelectedCabinetId(selectedCabinetId === cabinetId ? null : cabinetId);
  };

  return (
    <aside className="w-52 bg-[#0e0e0e] border-r border-white/[0.06] flex flex-col shrink-0">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h1 className="text-base font-semibold text-white tracking-tight">TagLauncher</h1>
      </div>

      <div className="flex bg-white/[0.03] border-b border-white/[0.06]">
        <button
          onClick={() => setSidebarTab("tags")}
          className={`flex-1 py-2.5 text-sm font-medium transition-all border-b-2 ${
            visibleSection === "tags"
              ? "text-blue-400 border-blue-400 bg-blue-400/10"
              : "text-white/50 border-transparent hover:text-white/70 hover:bg-white/[0.04]"
          }`}
        >
          标签
        </button>
        <button
          onClick={() => setSidebarTab("cabinets")}
          className={`flex-1 py-2.5 text-sm font-medium transition-all border-b-2 ${
            visibleSection === "cabinets"
              ? "text-blue-400 border-blue-400 bg-blue-400/10"
              : "text-white/50 border-transparent hover:text-white/70 hover:bg-white/[0.04]"
          }`}
        >
          收藏与文件柜
        </button>
      </div>

      {activeDrag?.kind === "item" && sidebarTab !== "cabinets" && (
        <div className="px-3 py-2 border-b border-blue-500/20 bg-blue-500/8 text-[11px] text-blue-300">
          拖拽中：已临时显示收藏夹和文件柜目标，释放即可归档对象
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {visibleSection === "tags" && (
          <>
            <button
              onClick={() => {
                setSelectedTagIds([]);
                setSelectedCabinetId(null);
                setShowFavorites(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                selectedTagIds.length === 0 &&
                selectedCabinetId === null &&
                !showFavorites
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
              }`}
            >
              全部项目
            </button>

            <div className="mt-2">
              <div className="space-y-0.5">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(event) => handleTagPointerDown(event, tag)}
                    onClick={() => handleTagClick(tag.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleTagSelection(tag.id);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setEditingTag(tag);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2.5 transition-all text-sm cursor-grab active:cursor-grabbing ${
                      selectedTagIds.includes(tag.id)
                        ? "bg-white/[0.08] text-white"
                        : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </div>
                ))}
              </div>

              {tags.length === 0 && (
                <p className="px-3 py-4 text-xs text-white/20 text-center">
                  点击下方按钮创建标签
                </p>
              )}

              <button
                onClick={() => setShowAddTag(true)}
                className="w-full mt-2 px-3 py-2 rounded-lg flex items-center gap-2 text-sm text-white/30 hover:bg-white/[0.04] hover:text-white/60 transition-all border border-dashed border-white/[0.08] hover:border-white/[0.15]"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span>新建标签</span>
              </button>
            </div>
          </>
        )}

        {visibleSection === "cabinets" && (
          <>
            <button
              data-drop-item-favorite={1}
              onClick={() => setShowFavorites(!showFavorites)}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 text-sm transition-all ${
                hoveredFavorites
                  ? "bg-yellow-500/16 text-yellow-300 ring-1 ring-yellow-400/35"
                  : showFavorites
                  ? "bg-yellow-500/20 text-yellow-400 font-medium"
                  : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill={showFavorites ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              <span>收藏夹</span>
            </button>

            <div className="mt-2">
              <div className="space-y-0.5">
                {cabinets.map((cab) => (
                  <button
                    key={cab.id}
                    data-drop-item-cabinet-id={cab.id}
                    onClick={() => handleCabinetClick(cab.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setEditingCabinet(cab);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg flex items-center gap-2.5 transition-all text-sm ${
                      hoveredCabinetId === cab.id
                        ? "bg-blue-500/12 text-white ring-1 ring-blue-400/40"
                        : selectedCabinetId === cab.id
                        ? "bg-white/[0.08] text-white"
                        : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded shrink-0 ring-1 ring-white/10"
                      style={{ backgroundColor: cab.color }}
                    />
                    <span className="truncate">{cab.name}</span>
                  </button>
                ))}
              </div>

              {cabinets.length === 0 && (
                <p className="px-3 py-4 text-xs text-white/20 text-center">
                  点击下方按钮创建文件柜
                </p>
              )}

              <button
                onClick={() => setShowAddCabinet(true)}
                className="w-full mt-2 px-3 py-2 rounded-lg flex items-center gap-2 text-sm text-white/30 hover:bg-white/[0.04] hover:text-white/60 transition-all border border-dashed border-white/[0.08] hover:border-white/[0.15]"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span>新建文件柜</span>
              </button>
            </div>
          </>
        )}
      </nav>

      <div className="px-3 py-2.5 border-t border-white/[0.06]">
        <p className="text-xs text-white/28 text-center">
          {activeDrag?.kind === "item"
            ? "释放到收藏夹或文件柜即可完成归档"
            : "拖拽标签到项目上，拖拽对象到收藏夹或文件柜"}
        </p>
      </div>

      {(showAddTag || editingTag) && (
        <TagEditor
          tag={editingTag}
          onSave={async (name, color) => {
            if (editingTag) {
              await onUpdateTag(editingTag.id, name, color);
            } else {
              await onAddTag(name, color);
            }
            setEditingTag(null);
            setShowAddTag(false);
          }}
          onDelete={editingTag ? () => {
            void onRemoveTag(editingTag.id);
            setEditingTag(null);
          } : undefined}
          onClose={() => {
            setEditingTag(null);
            setShowAddTag(false);
          }}
        />
      )}

      {(showAddCabinet || editingCabinet) && (
        <TagEditor
          tag={editingCabinet ? { id: editingCabinet.id, name: editingCabinet.name, color: editingCabinet.color } : null}
          label="文件柜"
          onSave={async (name, color) => {
            if (editingCabinet) {
              await onUpdateCabinet(editingCabinet.id, name, color);
            } else {
              await onAddCabinet(name, color);
            }
            setEditingCabinet(null);
            setShowAddCabinet(false);
          }}
          onDelete={editingCabinet ? () => {
            void onRemoveCabinet(editingCabinet.id);
            setEditingCabinet(null);
          } : undefined}
          onClose={() => {
            setEditingCabinet(null);
            setShowAddCabinet(false);
          }}
        />
      )}
    </aside>
  );
}

import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import {
  shouldSuppressInternalDragClick,
  useInternalDragStore,
} from "../stores/internalDragStore";
import type { Tag, Cabinet } from "../types";
import type { PanelDescriptor } from "../types/panel";
import { TagEditor } from "./TagEditor";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";
import { resolvePanel, firePanelEvent } from "../lib/panelRegistry";

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
  /** mod 创建的 sidebar 面板列表 */
  modPanels?: PanelDescriptor[];
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
  modPanels = [],
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
    <aside
      data-region="sidebar"
      className="bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] flex flex-col shrink-0"
      style={{ width: 'var(--sidebar-width)', backdropFilter: 'var(--sidebar-backdrop-filter)' }}
    >
      <div data-region="sidebar-header" className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <h1 className="text-base font-semibold text-[var(--text-primary)] tracking-tight">TagLauncher</h1>
      </div>

      <div data-region="sidebar-tabs" className="flex bg-[var(--bg-card)] border-b border-[var(--border-subtle)]">
        <button
          onClick={() => setSidebarTab("tags")}
          className={`flex-1 py-2.5 text-sm font-medium transition-all border-b-2 ${
            visibleSection === "tags"
              ? "text-[var(--accent-primary)] border-[var(--accent-primary)] bg-[var(--accent-primary-bg)]"
              : "text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          标签
        </button>
        <button
          onClick={() => setSidebarTab("cabinets")}
          className={`flex-1 py-2.5 text-sm font-medium transition-all border-b-2 ${
            visibleSection === "cabinets"
              ? "text-[var(--accent-primary)] border-[var(--accent-primary)] bg-[var(--accent-primary-bg)]"
              : "text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          收藏与文件柜
        </button>
      </div>

      {activeDrag?.kind === "item" && sidebarTab !== "cabinets" && (
        <div className="px-3 py-2 border-b border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[11px] text-[var(--accent-primary)]">
          拖拽中：已临时显示收藏夹和文件柜目标，释放即可归档对象
        </div>
      )}

      <nav data-region="sidebar-nav" className="flex-1 overflow-y-auto px-2 py-2">
        {visibleSection === "tags" && (
          <>
            <button
              onClick={() => {
                setSelectedTagIds([]);
                setSelectedCabinetId(null);
                setShowFavorites(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-[var(--radius-lg)] text-sm transition-all ${
                selectedTagIds.length === 0 &&
                selectedCabinetId === null &&
                !showFavorites
                  ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] font-medium"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
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
                    className={`w-full text-left px-3 py-1.5 rounded-[var(--radius-lg)] flex items-center gap-2.5 transition-all text-sm cursor-grab active:cursor-grabbing ${
                      selectedTagIds.includes(tag.id)
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] glow-accent"
                        : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-[var(--border-default)]"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </div>
                ))}
              </div>

              {tags.length === 0 && (
                <p className="px-3 py-4 text-xs text-[var(--text-ghost)] text-center">
                  点击下方按钮创建标签
                </p>
              )}

              <button
                onClick={() => setShowAddTag(true)}
                className="w-full mt-2 px-3 py-2 rounded-[var(--radius-lg)] flex items-center gap-2 text-sm text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-tertiary)] transition-all border border-dashed border-[var(--border-subtle)] hover:border-[var(--border-medium)]"
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
              className={`w-full text-left px-3 py-2 rounded-[var(--radius-lg)] flex items-center gap-2.5 text-sm transition-all ${
                hoveredFavorites
                  ? ""
                  : showFavorites
                  ? "font-medium"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              }`}
              style={
                hoveredFavorites
                  ? { color: "var(--color-favorite)", backgroundColor: "color-mix(in srgb, var(--color-favorite) 12%, transparent)", outline: "1px solid color-mix(in srgb, var(--color-favorite) 35%, transparent)", outlineOffset: "-1px" }
                  : showFavorites
                  ? { color: "var(--color-favorite)", backgroundColor: "color-mix(in srgb, var(--color-favorite) 16%, transparent)" }
                  : undefined
              }
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
                    className={`w-full text-left px-3 py-1.5 rounded-[var(--radius-lg)] flex items-center gap-2.5 transition-all text-sm ${
                      hoveredCabinetId === cab.id
                        ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]"
                        : selectedCabinetId === cab.id
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)] glow-accent"
                        : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded shrink-0 ring-1 ring-[var(--border-default)]"
                      style={{ backgroundColor: cab.color }}
                    />
                    <span className="truncate">{cab.name}</span>
                  </button>
                ))}
              </div>

              {cabinets.length === 0 && (
                <p className="px-3 py-4 text-xs text-[var(--text-ghost)] text-center">
                  点击下方按钮创建文件柜
                </p>
              )}

              <button
                onClick={() => setShowAddCabinet(true)}
                className="w-full mt-2 px-3 py-2 rounded-[var(--radius-lg)] flex items-center gap-2 text-sm text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-tertiary)] transition-all border border-dashed border-[var(--border-subtle)] hover:border-[var(--border-medium)]"
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

      {/* Mod Panel 扩展槽 */}
      {modPanels.filter((p) => p.visible !== false).length > 0 && (
        <div data-region="sidebar-panels" className="border-t border-[var(--border-subtle)]">
          {modPanels
            .filter((p) => p.visible !== false)
            .map((panel) => (
              <SidebarPanelSlot key={panel.id} panel={panel} />
            ))}
        </div>
      )}

      <div data-region="sidebar-footer" className="px-3 py-2.5 border-t border-[var(--border-subtle)]">
        <p className="text-xs text-[var(--text-faint)] text-center">
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

// ── Sidebar Panel 槽（折叠/展开 + 内容容器）────────────────────────────

function SidebarPanelSlot({ panel }: { panel: PanelDescriptor }) {
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resolved = useRef(false);

  // 仅在首次挂载时 resolve（空依赖数组确保组件复用时不重复 resolve）
  useEffect(() => {
    if (!resolved.current && containerRef.current) {
      resolved.current = true;
      resolvePanel(panel.id, containerRef.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="px-2 py-1">
      {/* 折叠/展开标题 */}
      {panel.collapsible ? (
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-[var(--radius-md)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
        >
          <span className="truncate">{panel.title}</span>
          <span className="shrink-0 ml-1 opacity-60">{collapsed ? "▶" : "▼"}</span>
        </button>
      ) : (
        <div
          className="flex items-center justify-between px-3 py-2 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="truncate">{panel.title}</span>
          <button
            className="shrink-0 ml-1 opacity-60 hover:opacity-100 transition-opacity"
            onClick={() => firePanelEvent(panel.id, "close")}
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      {/* 内容容器 */}
      {!collapsed && (
        <div
          ref={containerRef}
          className="mt-0.5 mx-1"
          style={{
            minHeight: "40px",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-sm)",
          }}
        />
      )}
    </div>
  );
}

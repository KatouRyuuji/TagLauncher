import { useEffect, useRef, useState } from "react";
import { TagEditor } from "./TagEditor";
import { resolvePanel, firePanelEvent } from "../lib/panelRegistry";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";
import { useAppStore } from "../stores/appStore";
import {
  shouldSuppressInternalDragClick,
  useInternalDragStore,
} from "../stores/internalDragStore";
import type { Cabinet, Tag } from "../types";
import type { PanelDescriptor } from "../types/panel";

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

  const handleTagPointerDown = (event: React.PointerEvent<HTMLElement>, tag: Tag) => {
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
    if (shouldSuppressInternalDragClick()) return;
    toggleTagSelection(tagId);
  };

  const handleCabinetClick = (cabinetId: number) => {
    if (shouldSuppressInternalDragClick()) return;
    setSelectedCabinetId(selectedCabinetId === cabinetId ? null : cabinetId);
  };

  return (
    <aside
      data-region="sidebar"
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      style={{ width: "var(--sidebar-width)", backdropFilter: "var(--sidebar-backdrop-filter)" }}
    >
      <div className="border-b border-[var(--border-subtle)] px-5 pb-4 pt-5">
        <div className="text-label">Launcher</div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text-primary)]">
              TagLauncher
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              轻量管理你的常用项目与资源入口
            </p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
            {tags.length} 标签
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="surface-card-soft flex gap-1 p-1">
          <SidebarTabButton
            active={visibleSection === "tags"}
            label="标签"
            onClick={() => setSidebarTab("tags")}
          />
          <SidebarTabButton
            active={visibleSection === "cabinets"}
            label="文件夹"
            onClick={() => setSidebarTab("cabinets")}
          />
        </div>
      </div>

      {activeDrag?.kind === "item" && sidebarTab !== "cabinets" && (
        <div className="mx-4 mt-4 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--accent-primary)_28%,transparent)] bg-[var(--accent-primary-bg)] px-3 py-2 text-xs text-[var(--accent-primary)]">
          正在拖拽项目，已自动切换到归档目标区域。
        </div>
      )}

      <nav data-region="sidebar-nav" className="flex-1 overflow-y-auto px-4 py-4">
        {visibleSection === "tags" && (
          <div className="space-y-4">
            <FilterNavButton
              active={selectedTagIds.length === 0 && selectedCabinetId === null && !showFavorites}
              title="全部项目"
              subtitle="查看所有可启动项"
              onClick={() => {
                setSelectedTagIds([]);
                setSelectedCabinetId(null);
                setShowFavorites(false);
              }}
            />

            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-label">标签集合</span>
                <span className="text-xs text-[var(--text-faint)]">{tags.length}</span>
              </div>

              <div className="space-y-2">
                {tags.map((tag) => {
                  const active = selectedTagIds.includes(tag.id);
                  return (
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
                      className={`group/card flex w-full cursor-grab items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-left active:cursor-grabbing ${
                        active
                          ? "border-[color-mix(in_srgb,var(--accent-primary)_26%,transparent)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                          : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/50"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
                      {active && (
                        <span className="rounded-[var(--radius-full)] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-primary)]">
                          Active
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {tags.length === 0 && (
                <div className="surface-card-soft mt-2 px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                  暂无标签，创建后可通过拖拽快速为项目归类。
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowAddTag(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-tertiary)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-primary-bg-light)] hover:text-[var(--accent-primary)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
                </svg>
                新建标签
              </button>
            </section>
          </div>
        )}

        {visibleSection === "cabinets" && (
          <div className="space-y-4">
            <FilterNavButton
              active={showFavorites}
              title="收藏夹"
              subtitle="优先展示常用项目"
              accent={hoveredFavorites ? "favorite" : undefined}
              onClick={() => setShowFavorites(!showFavorites)}
              data-drop-item-favorite={1}
            />

            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-label">文件柜</span>
                <span className="text-xs text-[var(--text-faint)]">{cabinets.length}</span>
              </div>

              <div className="space-y-2">
                {cabinets.map((cabinet) => {
                  const active = selectedCabinetId === cabinet.id;
                  const hovered = hoveredCabinetId === cabinet.id;
                  return (
                    <button
                      key={cabinet.id}
                      type="button"
                      data-drop-item-cabinet-id={cabinet.id}
                      onClick={() => handleCabinetClick(cabinet.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setEditingCabinet(cabinet);
                      }}
                      className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-left ${
                        hovered
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)] text-[var(--accent-primary)]"
                          : active
                          ? "border-[color-mix(in_srgb,var(--accent-primary)_24%,transparent)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                          : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-[4px] ring-2 ring-white/50"
                        style={{ backgroundColor: cabinet.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{cabinet.name}</span>
                    </button>
                  );
                })}
              </div>

              {cabinets.length === 0 && (
                <div className="surface-card-soft mt-2 px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                  暂无文件柜，可创建用于项目归档和场景分类。
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowAddCabinet(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-tertiary)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-primary-bg-light)] hover:text-[var(--accent-primary)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
                </svg>
                新建文件柜
              </button>
            </section>
          </div>
        )}
      </nav>

      {modPanels.filter((panel) => panel.visible !== false).length > 0 && (
        <div data-region="sidebar-panels" className="border-t border-[var(--border-subtle)] px-3 py-3">
          <div className="mb-1 px-2">
            <span className="text-label">扩展面板</span>
          </div>
          {modPanels
            .filter((panel) => panel.visible !== false)
            .map((panel) => (
              <SidebarPanelSlot key={panel.id} panel={panel} />
            ))}
        </div>
      )}

      <div className="border-t border-[var(--border-subtle)] px-5 py-4">
        <div className="surface-card-soft px-4 py-3 text-xs leading-6 text-[var(--text-muted)]">
          {activeDrag?.kind === "item"
            ? "释放到收藏夹或文件柜，即可完成项目归档。"
            : "拖拽标签到项目卡片上可快速追加分类，拖拽项目可加入收藏或文件柜。"}
        </div>
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

function SidebarTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`control-chip min-h-[36px] flex-1 text-sm font-medium ${active ? "control-chip-active" : ""}`}
    >
      {label}
    </button>
  );
}

function FilterNavButton({
  active,
  title,
  subtitle,
  onClick,
  accent,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  title: string;
  subtitle: string;
  accent?: "favorite";
}) {
  const accentStyle = accent === "favorite"
    ? {
        borderColor: "color-mix(in srgb, var(--color-favorite) 30%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--color-favorite) 12%, transparent)",
        color: "var(--color-favorite)",
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-left ${
        active
          ? "border-[color-mix(in_srgb,var(--accent-primary)_24%,transparent)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
          : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
      }`}
      style={accentStyle}
      {...props}
    >
      <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-white/65 text-current shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
        {accent === "favorite" ? (
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2.75 14.84 8.5l6.35.92-4.6 4.48 1.09 6.33L12 17.26l-5.68 2.97 1.09-6.33-4.6-4.48 6.35-.92L12 2.75Z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.75A2.75 2.75 0 0 1 6.75 5h10.5A2.75 2.75 0 0 1 20 7.75v8.5A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25v-8.5Z" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-current">{title}</span>
        <span className="mt-1 block text-xs text-[var(--text-muted)]">{subtitle}</span>
      </span>
    </button>
  );
}

function SidebarPanelSlot({ panel }: { panel: PanelDescriptor }) {
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resolved = useRef(false);

  useEffect(() => {
    if (!resolved.current && containerRef.current) {
      resolved.current = true;
      resolvePanel(panel.id, containerRef.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] p-2">
      {panel.collapsible ? (
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <span className="truncate font-medium">{panel.title}</span>
          <span className="text-[var(--text-faint)]">{collapsed ? "展开" : "收起"}</span>
        </button>
      ) : (
        <div className="flex items-center justify-between px-3 py-2 text-xs text-[var(--text-secondary)]">
          <span className="truncate font-medium">{panel.title}</span>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={() => firePanelEvent(panel.id, "close")}
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      {!collapsed && (
        <div
          ref={containerRef}
          className="mx-1 mt-1 min-h-[40px] rounded-[var(--radius-md)] px-2 py-1 text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-sm)" }}
        />
      )}
    </div>
  );
}

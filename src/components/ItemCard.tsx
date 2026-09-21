import { memo, useState, useRef, useEffect } from "react";
import { Check, FolderOpen, Play, TriangleAlert } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { DraggableTagList } from "./DraggableTagList";
import { FavoriteStar } from "./FavoriteStar";
import { ItemDragHandle } from "./ItemDragHandle";
import { ItemTagsEditor } from "./ItemTagsEditor";
import { ItemVisualIcon } from "./ItemVisualIcon";
import { useItemDragStart } from "./useItemDragStart";
import { cardOpenLabel } from "../lib/itemActionCopy";
import { getFileSuffix, getTypeLabel, splitPathTail, formatRelativeTime } from "../lib/itemUtils";
import { useInternalDragStore } from "../stores/internalDragStore";
import { useAppStore } from "../stores/appStore";
import { useModItemSlots } from "../hooks/useModItemSlots";
import { SearchHighlightText } from "./SearchHighlightText";
import type { Cabinet, ItemWithTags, Tag } from "../types";
import type { ItemSlotDescriptor } from "../lib/modItemSlotRegistry";

/**
 * 右键命中多选集时注入的选中集信息：右键菜单的删除/收藏/复制路径据此
 * 作用于整个选中集而非仅右击项。由 ItemGrid/ItemListView 统一构造。
 */
export interface ContextSelectionInfo {
  ids: number[];
  paths: string[];
  /** 多选收藏目标态：有未收藏项则为 true（与 Ctrl+D 同口径） */
  favoriteTarget: boolean;
}

export interface ItemCardProps {
  item: ItemWithTags;
  tags: Tag[];
  cabinets: Cabinet[];
  currentCabinetId: number | null;
  onLaunch: () => void;
  onRemoveTagFromItem: (itemId: number, tagId: number) => Promise<void>;
  onAddNewTagToItem: (itemId: number, tagName: string, baseTagIds?: number[]) => Promise<number[]>;
  onRecycleNewTags?: (tagIds: number[]) => Promise<void>;
  onSetTags: (itemId: number, tagIds: number[]) => Promise<void>;
  onToggleFavorite: () => void;
  onAddItemToCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onRemoveItemFromCabinet: (cabinetId: number, itemId: number) => Promise<void>;
  onClearCurrentFilter: (itemId: number) => Promise<void>;
  /** 批量清除当前筛选归类（整组拖拽落点用，单次 IPC/事务） */
  onClearCurrentFilters?: (itemIds: number[]) => Promise<void>;
  onRequestRemoveFromApp: (itemId: number, options?: { forceDialog?: boolean; preferDeleteFiles?: boolean }) => Promise<void>;
  onUpdateThumbnail: (itemId: number, iconPath: string | null) => Promise<void>;
  selected: boolean;
  /** 活动项（roving focus）：仅活动项在 Tab 序中（tabIndex=0），其余卡片 -1 */
  active?: boolean;
  /** 右击项属于当前多选集时非 null；ContextMenu 据此把部分动作扩展到整个选中集 */
  contextSelection?: ContextSelectionInfo | null;
  /** 大图标模式：封面为主，名称在下，不显示路径 */
  variant?: "card" | "icon";
  /** 拖拽起手 payload：拖动已选中项时 = 整个选中集（Explorer 语义），缺省 [item.id] */
  dragItemIds?: number[];
  onAddItemsToCabinet?: (cabinetId: number, itemIds: number[]) => Promise<void>;
  onSetFavorites?: (ids: number[], favorite: boolean) => Promise<void>;
  onRequestBatchRemoveFromApp?: () => Promise<void>;
}

/** 将 Mod 插槽的 HTMLElement 挂载到 ref 指向的容器（卡片/行共用） */
export function useSlotContainer(slots: ItemSlotDescriptor[], item: ItemWithTags) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || slots.length === 0) return;
    ref.current.innerHTML = "";
    for (const slot of slots) {
      try {
        const el = slot.render(item);
        el.setAttribute("data-mod-slot", slot.modId);
        ref.current.appendChild(el);
      } catch (err) {
        console.warn(`[ItemCard] Slot render error from mod "${slot.modId}":`, err);
      }
    }
  }, [slots, item]);
  return ref;
}

function ItemOpenButton({
  item,
  onLaunch,
  compact = false,
}: {
  item: ItemWithTags;
  onLaunch: () => void;
  compact?: boolean;
}) {
  const label = cardOpenLabel(item.type);
  const Icon = item.type === "folder" ? FolderOpen : Play;
  return (
    <button
      type="button"
      // 卡片/行是单一 Tab 停点（roving focus）：启动按钮退出 Tab 序，键盘用 Enter 启动
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onLaunch();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      title={label}
      aria-label={`${label} ${item.name}`}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--accent-primary)] opacity-0 transition-[color,background-color,opacity] hover:bg-[var(--accent-primary)] hover:text-[var(--text-invert)] focus-visible:opacity-100 group-hover:opacity-100 ${
        compact
          ? "bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)]"
          : "bg-[var(--accent-primary-bg)]"
      }`}
    >
      <Icon className="h-3 w-3" fill={item.type === "folder" ? "none" : "currentColor"} aria-hidden="true" />
    </button>
  );
}

function ItemCardComponent({
  item,
  tags,
  cabinets,
  currentCabinetId,
  onLaunch,
  onRemoveTagFromItem,
  onAddNewTagToItem,
  onRecycleNewTags,
  onSetTags,
  onToggleFavorite,
  onAddItemToCabinet,
  onRemoveItemFromCabinet,
  onClearCurrentFilter,
  onClearCurrentFilters,
  onRequestRemoveFromApp,
  onUpdateThumbnail,
  selected,
  active = false,
  contextSelection,
  variant = "card",
  dragItemIds,
  onAddItemsToCabinet,
  onSetFavorites,
  onRequestBatchRemoveFromApp,
}: ItemCardProps) {
  const iconLayout = variant === "icon";
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const tagDragOver = useInternalDragStore((state) =>
    state.drag?.kind === "tag" &&
    state.hoverTarget?.kind === "tag-item" &&
    state.hoverTarget.itemId === item.id,
  );
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cabinet) => cabinet.id === currentCabinetId)?.name ?? null;

  const handleItemHandlePointerDown = useItemDragStart({
    item,
    cabinets,
    currentCabinetId,
    dragItemIds,
    onToggleFavorite,
    onSetFavorites,
    onAddItemToCabinet,
    onAddItemsToCabinet,
    onClearCurrentFilter,
    onClearCurrentFilters,
    onRequestRemoveFromApp,
    onRequestBatchRemoveFromApp,
  });
  // 卡片本体拖拽（Explorer：从图标本体拖），与抓手同一起手；
  // 交互子元素（按钮/链接/输入/标签 pill/抓手）不触发，由它们各自的手势负责
  const handleCardBodyPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button,a,input,select,textarea,kbd,[role='button'],[data-tag-drag],[data-item-drag]")) return;
    handleItemHandlePointerDown(event);
  };
  const fileSuffix = getFileSuffix(item);
  const { dir: pathDir, tail: pathTail } = splitPathTail(item.path);
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const searchQuery = useAppStore((state) => state.searchQuery);
  // 大图标 ≥150% 档：大卡片要换更多信息——补路径与标签行（第三轮评审 P0）
  const iconSizeScale = useAppStore((state) => state.iconSizeScale);
  // 卡片 ≥150% 档补「上次使用」相对时间；「最近使用」视图任何档位都带时间维度
  const cardSizeScale = useAppStore((state) => state.cardSizeScale);
  const showRecent = useAppStore((state) => state.showRecent);
  const lastUsedText = formatRelativeTime(item.last_used_at);
  const showLastUsed = (cardSizeScale >= 1.45 || showRecent) && lastUsedText !== "";

  // Mod ItemCard 插槽
  const modSlots = useModItemSlots();
  const headerSlotRef = useSlotContainer(modSlots.header, item);
  const actionsSlotRef = useSlotContainer(modSlots.actions, item);
  const footerSlotRef = useSlotContainer(modSlots.footer, item);

  return (
    <>
      <article
        data-drop-tag-item-id={item.id}
        data-selectable-item-id={item.id}
        data-selected={selected ? "true" : "false"}
        role="listitem"
        aria-label={`${item.name}${selected ? "，已选择" : ""}`}
        className={`card-hover-lift item-card-render-scope item-focus-ring group relative flex cursor-pointer flex-col rounded-[var(--radius-xl)] border bg-[var(--bg-card)] shadow-[var(--shadow-card)] ${
          iconLayout ? "items-center p-2.5" : "p-3"
        } ${
          tagDragOver
            ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)]"
            : selected
            ? "border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] ring-1 ring-inset ring-[var(--accent-primary)]"
            : "border-[var(--line-hairline)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]"
        }`}
        style={{ backdropFilter: "var(--card-backdrop-filter)" }}
        onPointerDown={handleCardBodyPointerDown}
        onDoubleClick={onLaunch}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPos({ x: event.clientX, y: event.clientY });
        }}
        tabIndex={active ? 0 : -1}
      >
        {iconLayout ? (
          <>
            <div className="relative w-full">
              <div className="aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] text-[42px]">
                <ItemVisualIcon
                  item={item}
                  emojiClass="leading-none"
                  imageClass="h-full w-full object-cover"
                />
              </div>
              <span className="absolute left-1.5 bottom-1.5 inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--line-hairline)] bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                {getTypeLabel(item.type)}
              </span>
              {item.is_missing && (
                <span
                  className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_65%,transparent)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--color-warning-ink)]"
                  title="文件已丢失或移动到其他磁盘；应用内归类已保留，文件恢复后会自动重新关联"
                >
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                  失效
                </span>
              )}
              <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--bg-card)_86%,transparent)] p-0.5 shadow-[var(--shadow-sm)] backdrop-blur-sm">
                {selected && (
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] text-[var(--text-invert)]"
                    role="img"
                    aria-label="已选择"
                    title="已选择"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                  </span>
                )}
                <FavoriteStar active={item.is_favorite} onClick={onToggleFavorite} />
              </div>
              {/* 衬底与按钮同现同隐：按钮未浮出时不留空白银盒 */}
              <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--bg-card)_86%,transparent)] p-0.5 opacity-0 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <ItemOpenButton item={item} onLaunch={onLaunch} compact />
                <ItemDragHandle
                  onPointerDown={handleItemHandlePointerDown}
                  className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                />
              </div>
            </div>
            <h3
              className="mt-2 line-clamp-2 w-full text-center text-[13px] font-medium leading-4 text-[var(--text-primary)]"
              title={item.name}
            >
              <SearchHighlightText text={item.name} query={searchQuery} />
            </h3>
            {iconSizeScale >= 1.5 && (
              <>
                <p
                  className={`mt-0.5 flex w-full min-w-0 justify-center text-[12px] leading-4 ${
                    item.is_missing ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"
                  }`}
                  title={item.is_missing ? `最近已知位置：${item.path}` : item.path}
                >
                  <span className="min-w-0 truncate">{pathDir}</span>
                  <span dir="rtl" className="max-w-[60%] shrink-0 truncate text-left" style={{ unicodeBidi: "plaintext" }}>{pathTail}</span>
                </p>
                <div className="mt-1.5 w-full" onClick={(event) => event.stopPropagation()}>
                  <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} />
                </div>
              </>
            )}
          </>
        ) : (
          <>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-[var(--card-thumb-size)] w-[var(--card-thumb-size)] shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] text-[26px]">
            <ItemVisualIcon
              item={item}
              emojiClass="leading-none"
              imageClass="h-full w-full object-cover"
            />
          </div>

          {/* 文本列为右上角的星标/选中勾预留安全间距，任何状态下文字不与控件重叠 */}
          <div className={`min-w-0 flex-1 ${selected ? "pr-16" : "pr-9"}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-[var(--text-primary)]" title={item.name}>
                <SearchHighlightText text={item.name} query={searchQuery} />
              </h3>
              {item.is_missing && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_65%,transparent)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[13px] font-semibold leading-none text-[var(--color-warning-ink)]"
                  title="文件已丢失或移动到其他磁盘；应用内归类已保留，文件恢复后会自动重新关联"
                >
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                  失效
                </span>
              )}
            </div>
            <p
              className={`item-card-path mt-0.5 flex min-w-0 text-[13px] leading-4 ${
                item.is_missing ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"
              }`}
              title={item.is_missing ? `最近已知位置：${item.path}` : item.path}
            >
              {/* 目录段先行截断，末段名保底可见；末段自身超长时从头部省略，扩展名始终完整 */}
              <span className="min-w-0 truncate">{pathDir}</span>
              <span dir="rtl" className="max-w-[60%] shrink-0 truncate text-left" style={{ unicodeBidi: "plaintext" }}>{pathTail}</span>
            </p>
            {showLastUsed && (
              <p className="mt-0.5 truncate text-[12px] leading-4 text-[var(--text-faint)]">
                上次使用 {lastUsedText}
              </p>
            )}
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-[var(--text-faint)]">
              <span className="instrument-label truncate" title={getTypeLabel(item.type)}>
                {getTypeLabel(item.type)}
              </span>
              {fileSuffix !== "无后缀" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="data-readout truncate" title={fileSuffix}>
                    {fileSuffix}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 右上角常驻区：仅选中勾与星标（星标非收藏时半隐，组件内处理） */}
          <div className="absolute right-2.5 top-2.5 flex items-center gap-0.5">
            {modSlots.header.length > 0 && <div ref={headerSlotRef} className="flex items-center gap-1" />}
            {selected && (
              <span
                className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] text-[var(--text-invert)]"
                role="img"
                aria-label="已选择"
                title="已选择"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              </span>
            )}
            <FavoriteStar active={item.is_favorite} onClick={onToggleFavorite} />
          </div>
        </div>

        {/* 标签行：左侧标签列表，右侧启动/拖拽（悬停显现，在文档流内、不与文字重叠） */}
        <div className="mt-2.5 flex min-h-7 items-center gap-2">
          <div className="min-w-0 flex-1">
            <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Mod 插槽：actions */}
            {modSlots.actions.length > 0 && <div ref={actionsSlotRef} className="flex items-center gap-1" />}
            <ItemOpenButton item={item} onLaunch={onLaunch} />
            <ItemDragHandle
              onPointerDown={handleItemHandlePointerDown}
              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            />
          </div>
        </div>

        {/* Mod 插槽：footer */}
        {modSlots.footer.length > 0 && (
          <div ref={footerSlotRef} className="mt-2 border-t border-[var(--line-hairline)] pt-2" />
        )}
          </>
        )}
      </article>

      {menuPos && (
        <ContextMenu
          item={item}
          cabinets={cabinets}
          currentCabinetId={currentCabinetId}
          currentCabinetName={currentCabinetName}
          contextSelection={contextSelection}
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onLaunch={onLaunch}
          onRemove={() => void onRequestRemoveFromApp(item.id)}
          onRemoveFiles={() => void onRequestRemoveFromApp(item.id, { forceDialog: true, preferDeleteFiles: true })}
          onEditTags={() => setShowTagEditor(true)}
          onToggleFavorite={onToggleFavorite}
          onPreview={() => setPreviewItemId(item.id)}
          onAddItemToCabinet={onAddItemToCabinet}
          onRemoveItemFromCabinet={onRemoveItemFromCabinet}
          onUpdateThumbnail={onUpdateThumbnail}
        />
      )}

      {showTagEditor && (
        <ItemTagsEditor
          item={item}
          tags={tags}
          onSave={async (tagIds) => {
            await onSetTags(item.id, tagIds);
            setShowTagEditor(false);
          }}
          onAddNewTag={async (name, baseTagIds) => onAddNewTagToItem(item.id, name, baseTagIds)}
          onRecycleNewTags={onRecycleNewTags}
          onClose={() => setShowTagEditor(false)}
        />
      )}
    </>
  );
}

export const ItemCard = memo(ItemCardComponent);

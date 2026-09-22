import { memo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { DraggableTagList } from "./DraggableTagList";
import { FavoriteStar } from "./FavoriteStar";
import { ItemDragHandle } from "./ItemDragHandle";
import { ItemTagsEditor } from "./ItemTagsEditor";
import { ItemVisualIcon } from "./ItemVisualIcon";
import { useItemDragStart } from "./useItemDragStart";
import { getFileSuffix, getTypeLabel, getTypeDetail, splitPathTail, formatRelativeTime } from "../lib/itemUtils";
import { useInternalDragStore } from "../stores/internalDragStore";
import { useAppStore } from "../stores/appStore";
import { useModItemSlots } from "../hooks/useModItemSlots";
import { useSlotContainer } from "./ItemCard";
import { SearchHighlightText } from "./SearchHighlightText";
import type { ItemCardProps } from "./ItemCard";

/** 表头、数据行与骨架共同消费同一列模板，避免列宽漂移。
 *  名称列下限 120px、标签列下限 96px：保证最小窗口（800px）下名称可读、表头不竖排。 */
export const ITEM_LIST_GRID_TEMPLATE = "72px minmax(120px,1fr) minmax(96px,300px) 112px";
/** 普通行的稳定基准高度；Mod footer 与多行标签仍由虚拟化器动态测量。 */
export const ITEM_LIST_BASE_ROW_HEIGHT = 68;
/** 紧凑档行高：一屏行数约 +21%（11 行 → 13+ 行），信息结构不变只收留白 */
export const ITEM_LIST_COMPACT_ROW_HEIGHT = 56;

function ItemRowComponent({
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
  dragItemIds,
  onAddItemsToCabinet,
  onSetFavorites,
  onRequestBatchRemoveFromApp,
}: ItemCardProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);

  // Mod 插槽（与 ItemCard 对等：header / actions / footer）
  const modSlots = useModItemSlots();
  const headerSlotRef = useSlotContainer(modSlots.header, item);
  const actionsSlotRef = useSlotContainer(modSlots.actions, item);
  const footerSlotRef = useSlotContainer(modSlots.footer, item);
  const tagDragOver = useInternalDragStore((state) =>
    state.drag?.kind === "tag" &&
    state.hoverTarget?.kind === "tag-item" &&
    state.hoverTarget.itemId === item.id,
  );
  const currentCabinetName =
    currentCabinetId === null ? null : cabinets.find((cabinet) => cabinet.id === currentCabinetId)?.name ?? null;
  const setPreviewItemId = useAppStore((state) => state.setPreviewItemId);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const listDensity = useAppStore((state) => state.listDensity);
  const compact = listDensity === "compact";
  const rowHeight = compact ? ITEM_LIST_COMPACT_ROW_HEIGHT : ITEM_LIST_BASE_ROW_HEIGHT;
  // 「最近使用」视图补时间维度：否则「最近」只靠标题一句话支撑
  const showRecent = useAppStore((state) => state.showRecent);
  const lastUsedText = showRecent ? formatRelativeTime(item.last_used_at) : "";

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
  // 行本体拖拽（Explorer：从图标本体拖），与抓手同一起手；交互子元素不触发
  const handleRowBodyPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button,a,input,select,textarea,kbd,[role='button'],[data-tag-drag],[data-item-drag]")) return;
    handleItemHandlePointerDown(event);
  };

  return (
    <>
      <div
        data-drop-tag-item-id={item.id}
        data-selectable-item-id={item.id}
        role="listitem"
        style={{ minHeight: rowHeight, gridTemplateColumns: ITEM_LIST_GRID_TEMPLATE }}
        className={`item-row-render-scope item-focus-ring group grid items-center gap-3 border-b border-[color-mix(in_srgb,var(--border-default)_88%,transparent)] px-4 ${compact ? "py-1.5" : "py-2"} ${
          tagDragOver
            ? "bg-[var(--accent-primary-bg-light)] shadow-[inset_3px_0_0_var(--accent-primary)]"
            : selected
            ? "bg-[var(--accent-primary-bg)] shadow-[inset_3px_0_0_var(--accent-primary)]"
            : "hover:bg-[var(--bg-hover)]"
        }`}
        onPointerDown={handleRowBodyPointerDown}
        onDoubleClick={onLaunch}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuPos({ x: event.clientX, y: event.clientY });
        }}
        tabIndex={active ? 0 : -1}
      >
        <div className="flex items-center gap-1">
          <ItemDragHandle
            onPointerDown={handleItemHandlePointerDown}
            className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
          {/* 星标跨视图统一常驻右侧（列表在行尾、卡片在右上）：不再 hover 才现，
              非收藏态由 FavoriteStar 组件内半隐处理 */}
          {modSlots.header.length > 0 && <div ref={headerSlotRef} className="flex min-w-0 items-center" />}
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] ${compact ? "h-8 w-8 text-base" : "h-10 w-10 text-xl"}`}>
            <ItemVisualIcon
              item={item}
              emojiClass="leading-none"
              imageClass="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate text-[14px] font-semibold leading-5 text-[var(--text-primary)]" title={item.name}>
              <span className="truncate">
                <SearchHighlightText text={item.name} query={searchQuery} />
              </span>
              {item.is_missing && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-warning)_65%,transparent)] bg-[var(--status-warning-bg)] px-1 py-0.5 text-[13px] font-semibold leading-none text-[var(--color-warning-ink)]"
                  title="文件已丢失或移动到其他磁盘；应用内归类已保留，文件恢复后会自动重新关联"
                >
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                  失效
                </span>
              )}
            </h3>
            <p
              className={`mt-0.5 flex min-w-0 text-[13px] leading-4 ${item.is_missing ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"}`}
              title={item.is_missing ? `最近已知位置：${item.path}` : item.path}
            >
              {/* 目录段先行截断，末段名保底可见；末段自身超长时从头部省略，扩展名始终完整 */}
              <span className="min-w-0 truncate">{splitPathTail(item.path).dir}</span>
              <span dir="rtl" className="max-w-[60%] shrink-0 truncate text-left" style={{ unicodeBidi: "plaintext" }}>{splitPathTail(item.path).tail}</span>
            </p>
            {/* 元行高度对齐：失效且从未启动时也要占住这一行，不比邻居「矮一截」 */}
            {(lastUsedText !== "" || item.is_missing) && (
              <p className={`mt-0.5 truncate text-[12px] leading-4 ${item.is_missing && lastUsedText === "" ? "text-[var(--color-warning-ink)]" : "text-[var(--text-faint)]"}`}>
                {lastUsedText !== "" ? `上次使用 ${lastUsedText}` : "失效 · 可找回"}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 max-w-[280px] overflow-hidden">
          <DraggableTagList item={item} onReorder={onSetTags} onRemoveTag={onRemoveTagFromItem} compact />
        </div>

        <div className="text-right">
          {modSlots.actions.length > 0 && <div ref={actionsSlotRef} className="mb-0.5 flex justify-end" />}
          {/* 星标是独立动作位（固定 28px），不贴在类型文案末尾被读成类型的一部分 */}
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-right text-[13px] font-semibold text-[var(--text-secondary)]" title={getTypeDetail(item.type)}>
              {getTypeLabel(item.type)}
            </p>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center [&_button]:bg-transparent">
              <FavoriteStar active={item.is_favorite} onClick={onToggleFavorite} />
            </span>
          </div>
          {getFileSuffix(item) !== "无后缀" && (
            <p className="data-readout mt-0.5 truncate text-[13px] text-[var(--text-faint)]" title={getFileSuffix(item)}>
              {getFileSuffix(item)}
            </p>
          )}
        </div>
      </div>

      {modSlots.footer.length > 0 && (
        <div ref={footerSlotRef} className="border-b border-[var(--line-hairline)] px-3 py-1.5" />
      )}

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

export const ItemRow = memo(ItemRowComponent);

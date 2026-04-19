import type { ItemWithTags } from "../types";
import { useInternalDragStore } from "../stores/internalDragStore";
import {
  beginInternalPointerDrag,
  findClosestNumberDataAttribute,
} from "../lib/internalPointerDrag";

interface DraggableTagListProps {
  item: ItemWithTags;
  onReorder: (itemId: number, newTagIds: number[]) => Promise<void>;
  onRemoveTag: (itemId: number, tagId: number) => Promise<void>;
  compact?: boolean;
}

export function DraggableTagList({ item, onReorder, onRemoveTag, compact }: DraggableTagListProps) {
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
    if (!tag) return;

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
          } ${overIdx === idx && dragIdx !== null && dragIdx !== idx ? "ring-1 ring-[var(--accent-primary)]" : ""}`}
          style={{ backgroundColor: `color-mix(in srgb, ${tag.color} var(--tag-color-alpha, 20%), transparent)`, color: tag.color }}
        >
          {tag.name}
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void onRemoveTag(item.id, tag.id); }}
            className="ml-0.5 opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto hover:text-[var(--text-primary)] transition-opacity"
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
              ? "border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
              : "border-[var(--border-medium)] text-[var(--text-faint)]"
          }`}
        >
          拖拽到此移除
        </span>
      )}
    </div>
  );
}

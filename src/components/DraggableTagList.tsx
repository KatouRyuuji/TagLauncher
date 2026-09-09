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
  const dragIdx = useInternalDragStore((state) =>
    state.drag?.kind === "reorder-tag" && state.drag.itemId === item.id
      ? state.drag.sourceIdx
      : null,
  );
  const overTarget = useInternalDragStore((state) =>
    state.hoverTarget?.kind === "reorder-tag" && state.hoverTarget.itemId === item.id
      ? state.hoverTarget
      : null,
  );
  const removeZoneActive = useInternalDragStore((state) =>
    state.hoverTarget?.kind === "reorder-remove" && state.hoverTarget.itemId === item.id,
  );

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

        const element = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
        const pill = element instanceof HTMLElement
          ? element.closest<HTMLElement>("[data-reorder-tag-idx]")
          : null;
        if (pill) {
          const targetItemId = Number(pill.dataset.reorderTagItemId);
          const targetIdx = Number(pill.dataset.reorderTagIdx);
          if (targetItemId === item.id && Number.isInteger(targetIdx)) {
            // 指针落在目标左半区则插入到其前、右半区插入到其后，
            // 末位标签的右半区即「拖到最后一位」的落点。
            const rect = pill.getBoundingClientRect();
            const after = pointerEvent.clientX > rect.left + rect.width / 2;
            return { kind: "reorder-tag", itemId: item.id, targetIdx, after };
          }
        }

        return null;
      },
      onDrop: async (target) => {
        if (target?.kind === "reorder-remove" && target.itemId === item.id) {
          await onRemoveTag(item.id, tag.id);
          return;
        }

        if (target?.kind !== "reorder-tag" || target.itemId !== item.id) {
          return;
        }

        // 落点统一换算为原数组的插入槽位 slot（0..n）：
        // slot === idx（自身前）或 slot === idx + 1（自身后）时顺序不变，直接跳过。
        const slot = target.after ? target.targetIdx + 1 : target.targetIdx;
        if (slot === idx || slot === idx + 1) {
          return;
        }

        const tagIds = item.tags.map((itemTag) => itemTag.id);
        const [moved] = tagIds.splice(idx, 1);
        // 向后拖（slot > idx）时移除源元素后槽位前移一位，需减 1 校正。
        const insertAt = slot > idx ? slot - 1 : slot;
        tagIds.splice(insertAt, 0, moved);
        await onReorder(item.id, tagIds);
      },
    });
  };

  if (item.tags.length === 0) return null;

  // 悬停高亮与实际落点一致：落点为插入槽位（左半区=目标前，右半区=目标后），
  // 落点是原位（自身前/后）时顺序不变，不高亮。
  const overSlot =
    overTarget === null ? null : overTarget.after ? overTarget.targetIdx + 1 : overTarget.targetIdx;
  const highlightIdx =
    overTarget !== null && overSlot !== null && dragIdx !== null && overSlot !== dragIdx && overSlot !== dragIdx + 1
      ? overTarget.targetIdx
      : null;

  return (
    <div
      data-tag-drag="true"
      className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"}`}
    >
      {item.tags.map((tag, idx) => (
        <span
          key={tag.id}
          data-tag-drag="true"
          data-reorder-tag-item-id={item.id}
          data-reorder-tag-idx={idx}
          onPointerDown={(event) => handleTagPointerDown(event, idx)}
          onDoubleClick={(event) => event.stopPropagation()}
          className={`inline-flex items-center rounded-[var(--radius-full)] border font-medium cursor-grab active:cursor-grabbing transition-all group/tag ${
            compact ? "gap-1 px-2 py-0.5 text-[13px]" : "gap-1.5 px-2.5 py-1 text-[13px]"
          } ${
            dragIdx === idx ? "opacity-40" : ""
          } ${highlightIdx === idx ? "ring-1 ring-[var(--accent-primary)]" : ""}`}
          style={{
            backgroundColor: `color-mix(in srgb, ${tag.color} var(--tag-color-alpha, 20%), var(--bg-card))`,
            color: tag.color,
            borderColor: `color-mix(in srgb, ${tag.color} 28%, transparent)`,
          }}
        >
          {tag.name}
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              // 失败提示已由 onRemoveTag 链路（withErrorToast）统一弹出，吞掉 rejection 避免噪音
              void onRemoveTag(item.id, tag.id).catch(() => {});
            }}
            className="opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto hover:text-[var(--text-primary)] transition-opacity"
          >
            ×
          </button>
        </span>
      ))}
      {dragIdx !== null && (
        <span
          data-reorder-remove-item-id={item.id}
          onDoubleClick={(event) => event.stopPropagation()}
          className={`inline-flex items-center rounded-[var(--radius-full)] border border-dashed px-2.5 py-1 text-[13px] font-medium transition-all ${
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

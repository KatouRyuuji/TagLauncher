import { useState, useEffect } from "react";
import {
  getItemSlotsForPosition,
  subscribeItemSlots,
  type ItemSlotPosition,
  type ItemSlotDescriptor,
} from "../lib/modItemSlotRegistry";

/**
 * 订阅 Mod 注册的 ItemCard 插槽变化。
 * 返回按 position 分组的插槽描述符列表。
 */
export function useModItemSlots(): Record<ItemSlotPosition, ItemSlotDescriptor[]> {
  const [slots, setSlots] = useState(() => ({
    header: getItemSlotsForPosition("header"),
    footer: getItemSlotsForPosition("footer"),
    actions: getItemSlotsForPosition("actions"),
  }));

  useEffect(() => {
    const update = () =>
      setSlots({
        header: getItemSlotsForPosition("header"),
        footer: getItemSlotsForPosition("footer"),
        actions: getItemSlotsForPosition("actions"),
      });
    return subscribeItemSlots(update);
  }, []);

  return slots;
}

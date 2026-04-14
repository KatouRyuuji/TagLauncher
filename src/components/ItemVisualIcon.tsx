import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ItemWithTags } from "../types";
import { TYPE_ICONS } from "../lib/itemUtils";

export function ItemVisualIcon({ item, emojiClass, imageClass }: { item: ItemWithTags; emojiClass: string; imageClass: string }) {
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

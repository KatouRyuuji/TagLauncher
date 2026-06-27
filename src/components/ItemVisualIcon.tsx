import { useState, useEffect, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ItemWithTags } from "../types";
import { TYPE_ICONS } from "../lib/itemUtils";

export function ItemVisualIcon({ item, emojiClass, imageClass }: { item: ItemWithTags; emojiClass: string; imageClass: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconPath = item.icon_path?.trim();

  // 图标路径不变时复用同一资源 URL，避免大列表每次渲染重复做路径转换
  const imageSrc = useMemo(
    () => (iconPath ? convertFileSrc(iconPath.replace(/\\/g, "/")) : null),
    [iconPath],
  );

  useEffect(() => {
    setImageFailed(false);
  }, [iconPath]);

  if (imageSrc && !imageFailed) {
    return (
      <img
        src={imageSrc}
        alt={`${item.name} 缩略图`}
        className={imageClass}
        loading="lazy"
        onError={() => setImageFailed(true)}
        draggable={false}
      />
    );
  }
  if (item.type === "audio") {
    return (
      <svg className="h-6 w-6 text-[var(--accent-primary)]" viewBox="0 0 32 32" fill="none" aria-label="音频">
        <rect x="6" y="5" width="20" height="22" rx="5" fill="currentColor" opacity="0.12" />
        <path d="M20.5 8.8v12.3a3.4 3.4 0 1 1-1.9-3V12l-7.1 1.7v8.8a3.4 3.4 0 1 1-1.9-3V12.2a1.6 1.6 0 0 1 1.2-1.6l7.8-1.9a1.5 1.5 0 0 1 1.9 1.5Z" fill="currentColor" />
      </svg>
    );
  }
  return <span className={emojiClass}>{TYPE_ICONS[item.type] || "📄"}</span>;
}

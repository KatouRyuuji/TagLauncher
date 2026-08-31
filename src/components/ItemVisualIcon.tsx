import { useState, useEffect, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AppWindow,
  File,
  FileAudio,
  FileCode,
  FileImage,
  Folder,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { ItemWithTags } from "../types";
import { getTypeLabel } from "../lib/itemUtils";

const FALLBACK_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  image: FileImage,
  audio: FileAudio,
  exe: AppWindow,
  bat: SquareTerminal,
  ps1: FileCode,
};

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
  const FallbackIcon = FALLBACK_ICONS[item.type] ?? File;
  return (
    <FallbackIcon
      className={`h-[1em] w-[1em] text-[var(--accent-primary)] ${emojiClass}`}
      strokeWidth={1.65}
      role="img"
      aria-label={`${getTypeLabel(item.type)}图标`}
    />
  );
}

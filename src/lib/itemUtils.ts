import type { ItemWithTags } from "../types";

export const TYPE_ICONS: Record<string, string> = {
  folder: "📁",
  image: "🖼️",
  exe: "⚙️",
  bat: "📜",
  ps1: "🔧",
};

export const TYPE_LABELS: Record<string, string> = {
  folder: "文件夹",
  image: "图片",
  exe: "应用程序",
  bat: "批处理",
  ps1: "PowerShell",
};

export function getTypeLabel(itemType: string): string {
  return TYPE_LABELS[itemType] || itemType;
}

export function getFileSuffix(item: ItemWithTags): string {
  if (item.type === "folder") return "无后缀";
  const name = item.name || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "无后缀";
  return name.slice(dot).toLowerCase();
}

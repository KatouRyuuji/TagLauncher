import type { ItemWithTags } from "../types";

export const TYPE_ICONS: Record<string, string> = {
  folder: "📁",
  image: "🖼️",
  audio: "♪",
  exe: "⚙️",
  bat: "📜",
  ps1: "🔧",
};

export const TYPE_LABELS: Record<string, string> = {
  folder: "文件夹",
  image: "图片",
  audio: "音频",
  exe: "应用程序",
  bat: "批处理",
  ps1: "PowerShell",
};

export function getTypeLabel(itemType: string): string {
  return TYPE_LABELS[itemType] || itemType;
}

/** 中段折叠省略号；保留头尾字符的兜底折叠（文件名自身超长时使用）。 */
function foldMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const keep = Math.max(1, maxLength - 1);
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * 命令面板等窄行内展示路径：超长时保留盘符/根前缀与文件名，中段目录折叠为「…」。
 * 优先牺牲中间目录——用户靠「在哪个盘 + 叫什么名」定位对象，中段目录信息量最低。
 */
export function truncatePathMiddle(path: string, maxLength = 56): string {
  const trimmed = path.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const sep = trimmed.includes("/") && !trimmed.includes("\\") ? "/" : "\\";
  // UNC（\\server\share）等前导分隔符属于根前缀语义，折叠时须原样保留
  const lead = /^[\\/]+/.exec(trimmed)?.[0] ?? "";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";

  // 文件名自身放不下：退化为整串头尾折叠
  if (parts.length < 2 || `${lead}${parts[0]}${sep}…${sep}${last}`.length > maxLength) {
    return foldMiddle(trimmed, maxLength);
  }

  const suffix = `${sep}…${sep}${last}`;
  let prefix = `${lead}${parts[0]}`;
  for (let i = 1; i < parts.length - 1; i++) {
    const next = `${prefix}${sep}${parts[i]}`;
    if (next.length + suffix.length > maxLength) break;
    prefix = next;
  }
  return `${prefix}${suffix}`;
}

export function getFileSuffix(item: ItemWithTags): string {
  if (item.type === "folder") return "无后缀";
  const name = item.name || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "无后缀";
  return name.slice(dot).toLowerCase();
}

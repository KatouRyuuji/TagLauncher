// 外部文件拖拽路径解析工具
// 从 App.tsx 抽离的纯函数，行为完全保持一致。

export function hasPotentialExternalFileDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? []);

  if (types.includes("Files") || types.includes("text/uri-list")) {
    return true;
  }

  if (dataTransfer.files.length > 0 || dataTransfer.items.length > 0) {
    return true;
  }

  // WebView2 在外部拖拽进入阶段不一定稳定暴露标准类型。
  // 没有类型时先允许主视图接管，真正落下时再解析路径。
  return types.length === 0;
}

export function fileUriToPath(uri: string): string | null {
  const value = uri.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") return null;

    let pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }

    if (parsed.host) {
      return `\\\\${parsed.host}${pathname.replace(/\//g, "\\")}`;
    }

    return pathname.replace(/\//g, "\\");
  } catch {
    return null;
  }
}

export function extractDroppedPaths(dataTransfer: DataTransfer): string[] {
  const result = new Set<string>();

  for (const file of Array.from(dataTransfer.files ?? [])) {
    const fileWithPath = file as File & { path?: string };
    if (typeof fileWithPath.path === "string" && fileWithPath.path.trim().length > 0) {
      result.add(fileWithPath.path.trim());
    }
  }

  const uriList = dataTransfer.getData("text/uri-list");
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const path = fileUriToPath(trimmed);
    if (path) {
      result.add(path);
    }
  }

  const plain = dataTransfer.getData("text/plain");
  for (const line of plain.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("file://")) continue;
    const path = fileUriToPath(trimmed);
    if (path) {
      result.add(path);
    }
  }

  return Array.from(result);
}

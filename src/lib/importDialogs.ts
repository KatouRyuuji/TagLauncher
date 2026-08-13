import { open } from "@tauri-apps/plugin-dialog";

export async function pickFilesToAdd(): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    filters: [
      { name: "可执行文件", extensions: ["exe", "bat", "ps1"] },
      { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic", "heif"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (!selected) return null;
  return Array.isArray(selected) ? selected : [selected];
}

export async function pickFoldersToAdd(): Promise<string[] | null> {
  const selected = await open({ directory: true, multiple: true });
  if (!selected) return null;
  return Array.isArray(selected) ? selected : [selected];
}

import { open } from "@tauri-apps/plugin-dialog";

export async function pickFilesToAdd(): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    filters: [
      { name: "可执行文件", extensions: ["exe", "bat", "ps1"] },
      { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "svg", "tif", "tiff", "avif", "heic", "heif"] },
      { name: "音频文件", extensions: ["aac", "ape", "aiff", "aif", "afc", "aifc", "mp3", "mp2", "mp1", "wav", "wave", "wv", "opus", "flac", "ogg", "m4a", "m4b", "m4p", "m4r", "mpc", "mpp", "spx"] },
      { name: "视频文件", extensions: ["mp4", "m4v", "mkv", "avi", "mov", "wmv", "flv", "webm", "mpg", "mpeg", "mpe", "m2v", "3gp", "3g2", "mts", "m2ts", "vob", "rm", "rmvb", "asf", "divx", "ogv", "f4v", "mxf"] },
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

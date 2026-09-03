// ============================================================================
// demo/assets.ts — 演示资源生成器（仅 demo 模式使用）
// ============================================================================
// 把虚构的文件路径确定性地映射为内联 SVG data URL，充当缩略图 / 图标 /
// 专辑封面。同一路径恒生成同一图像，保证截图可复现；不依赖任何外部素材。
// ============================================================================

export interface DemoVisual {
  /** 主视觉 Emoji（知名对象的品牌化联想，如 🎧） */
  emoji: string;
  /** 渐变起止色 */
  from: string;
  to: string;
}

/** 已知路径的定制视觉（key 为正则化后的绝对路径） */
const PATH_VISUALS: Record<string, DemoVisual> = {
  // folder
  "C:/Users/Ryu/Documents/工作文档": { emoji: "📁", from: "#f59e0b", to: "#d97706" },
  "D:/Photos/旅行照片": { emoji: "🏞️", from: "#34d399", to: "#059669" },
  "E:/Media/影视收藏": { emoji: "🎬", from: "#f472b6", to: "#db2777" },
  // image
  "D:/Pictures/艺术收藏/蒙娜丽莎.jpg": { emoji: "🖼️", from: "#a16207", to: "#713f12" },
  "D:/Photos/2024-青海/青海湖日落.jpg": { emoji: "🌅", from: "#fb923c", to: "#c2410c" },
  // audio（专辑封面与卡片缩略图同视觉）
  "D:/Music/华语流行/周杰伦 - 晴天.mp3": { emoji: "🎵", from: "#fb7185", to: "#e11d48" },
};

/** 缩略图缓存路径 item-<id>.png → 视觉（与 data.ts 中的对象一一对应） */
const THUMB_VISUALS: Record<number, DemoVisual> = {
  1: { emoji: "📁", from: "#f59e0b", to: "#d97706" },
  2: { emoji: "🏞️", from: "#34d399", to: "#059669" },
  3: { emoji: "🎬", from: "#f472b6", to: "#db2777" },
  6: { emoji: "🎵", from: "#fb7185", to: "#e11d48" },
  7: { emoji: "📝", from: "#38bdf8", to: "#0369a1" },
  8: { emoji: "⛩️", from: "#fda4af", to: "#be123c" },
  9: { emoji: "⚙️", from: "#93c5fd", to: "#1d4ed8" },
  10: { emoji: "🔄", from: "#6ee7b7", to: "#047857" },
};

const FALLBACK_PALETTE: Array<[string, string]> = [
  ["#93c5fd", "#3b82f6"],
  ["#fca5a5", "#ef4444"],
  ["#fcd34d", "#f59e0b"],
  ["#86efac", "#22c55e"],
  ["#67e8f9", "#06b6d4"],
  ["#d8b4fe", "#a855f7"],
];

/** 简易稳定哈希（FNV-1a 32bit），保证同一路径视觉恒定 */
function hashPath(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

function lookupVisual(path: string): DemoVisual {
  const normalized = normalize(path);
  const known = PATH_VISUALS[normalized];
  if (known) return known;
  const thumbMatch = /Thumbnails\/item-(\d+)\.png$/.exec(normalized);
  if (thumbMatch) {
    const visual = THUMB_VISUALS[Number(thumbMatch[1])];
    if (visual) return visual;
  }
  const [from, to] = FALLBACK_PALETTE[hashPath(normalized) % FALLBACK_PALETTE.length];
  return { emoji: "📄", from, to };
}

function buildSvg(visual: DemoVisual): string {
  const id = `g${hashPath(visual.from + visual.to).toString(36)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${visual.from}"/><stop offset="1" stop-color="${visual.to}"/>`
    + `</linearGradient></defs>`
    + `<rect width="512" height="512" rx="96" fill="url(#${id})"/>`
    + `<circle cx="396" cy="116" r="180" fill="#ffffff" opacity="0.10"/>`
    + `<circle cx="96" cy="420" r="140" fill="#000000" opacity="0.08"/>`
    + `<text x="256" y="300" font-size="200" text-anchor="middle">${visual.emoji}</text>`
    + `</svg>`;
}

/**
 * demo 版 convertFileSrc：任意路径 → 内联 SVG data URL。
 * 真实环境由 Tauri 把磁盘路径转为 asset: URL；demo 环境无磁盘文件，
 * 改为程序化生成确定性占位图，视觉上等同真实缩略图。
 */
export function demoAssetUrl(path: string): string {
  const svg = buildSvg(lookupVisual(path));
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 专辑封面：按音频文件路径生成（与缩略图同一视觉，保持卡片/预览一致） */
export function demoAlbumCover(path: string): string {
  return demoAssetUrl(path);
}

/**
 * 生成极短的静音 WAV data URL（16bit 单声道）。
 * 快速预览会给 <audio> 元素喂 convertFileSrc(音频路径)：真实环境是磁盘文件，
 * demo 环境无音频可播，喂一段合法静音 WAV，让播放器正常加载元数据而不是报错。
 */
let cachedWavDataUrl: string | null = null;
export function demoSilentAudioUrl(): string {
  if (cachedWavDataUrl) return cachedWavDataUrl;
  const sampleRate = 8000;
  const seconds = 0.3;
  const dataSize = Math.floor(sampleRate * seconds) * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  // 采样区保持 0（静音）
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  cachedWavDataUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedWavDataUrl;
}

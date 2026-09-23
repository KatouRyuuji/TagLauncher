// ============================================================================
// demo/assets.ts — 演示资源生成器（仅 demo 模式使用）
// ============================================================================
// 把虚构的文件路径确定性地映射为内联 SVG data URL，充当缩略图 / 图标 /
// 专辑封面。同一路径恒生成同一图像，保证截图可复现；不依赖任何外部素材。
// 图形语言按对象类型区分（风景/胶片/均衡器/文件夹/窗口/终端），
// 背景只轻度借用对象主标签色；内容图形用矢量形状，避免演示占位图主导界面。
// ============================================================================

import { DEMO_ITEMS, DEMO_TAGS } from "./data";

/** 图形语言：按对象类型区分构图，而非仅按色相 */
export type DemoMotif = "folder" | "image" | "audio" | "video" | "app" | "script" | "file";

export interface DemoVisual {
  /** 渐变起止色 */
  from: string;
  to: string;
  /** 构图母题 */
  motif: DemoMotif;
}

/** 把标签色混入中性底色，保留差异但降低演示内容的饱和度。 */
function blend(hex: string, neutral: string, neutralWeight: number): string {
  const n = parseInt(hex.slice(1), 16);
  const base = parseInt(neutral.slice(1), 16);
  const mix = (shift: number) => Math.round(((n >> shift) & 255) * (1 - neutralWeight) + ((base >> shift) & 255) * neutralWeight);
  const r = mix(16);
  const g = mix(8);
  const b = mix(0);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const tagColorById = new Map(DEMO_TAGS.map((tag) => [tag.id, tag.color]));
const itemById = new Map(DEMO_ITEMS.map((item) => [item.id, item]));

/** 主标签色 → 低饱和底色；路径哈希仅改变轻微明度。 */
function firstTagGradient(itemId: number, h: number): { from: string; to: string } | null {
  const item = itemById.get(itemId);
  const color = item?.tagIds[0] != null ? tagColorById.get(item!.tagIds[0]) : undefined;
  if (!color) return null;
  const tint = h % 2 === 0 ? "#e9ecf0" : "#e1e6eb";
  return { from: blend(color, tint, 0.76), to: blend(color, "#aeb8c2", 0.62) };
}

const FALLBACK_PALETTE: Array<[string, string]> = [
  ["#dbe4eb", "#a9b9c8"],
  ["#ebdfe0", "#c9acae"],
  ["#e9e4d9", "#c5b99d"],
  ["#dfe9e2", "#aac0b0"],
  ["#dce8e8", "#a9c0c3"],
  ["#e6e1e9", "#bcb0c6"],
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

function itemIdForPath(normalized: string): number | null {
  const thumbMatch = /Thumbnails\/item-(\d+)\.png$/.exec(normalized);
  if (thumbMatch) return Number(thumbMatch[1]);
  return DEMO_ITEMS.find((item) => normalize(item.path) === normalized)?.id ?? null;
}

/** 对象类型 → 构图母题 */
const MOTIF_BY_TYPE: Record<string, DemoMotif> = {
  folder: "folder",
  image: "image",
  audio: "audio",
  video: "video",
  exe: "app",
  lnk: "app",
  bat: "script",
  cmd: "script",
  ps1: "script",
  sh: "script",
};

/** 无对象信息时按扩展名推断母题 */
function motifForPath(normalized: string): DemoMotif {
  if (/\.(mp4|m4v|mkv|avi|mov|wmv|flv|webm)$/i.test(normalized)) return "video";
  if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(normalized)) return "image";
  if (/\.(mp3|flac|wav|ogg|m4a|aac)$/i.test(normalized)) return "audio";
  if (/\.(exe|lnk)$/i.test(normalized)) return "app";
  if (/\.(bat|cmd|ps1|sh)$/i.test(normalized)) return "script";
  return "file";
}

function lookupVisual(path: string): DemoVisual {
  const normalized = normalize(path);
  const itemId = itemIdForPath(normalized);
  const h = hashPath(normalized);
  if (itemId !== null) {
    const gradient = firstTagGradient(itemId, h);
    if (gradient) {
      const item = itemById.get(itemId);
      // 缩略图（thumb-N.png）的构图按对象类型走，不按缩略图自己的扩展名
      const motif = item ? (MOTIF_BY_TYPE[item.type] ?? "file") : "file";
      return { motif, ...gradient };
    }
  }
  const [from, to] = FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
  return { motif: motifForPath(normalized), from, to };
}

/** 960×640 场景：构图按母题分叉，渐变方向也随哈希变化 */
function buildScene(visual: DemoVisual, path: string): string {
  // 文件夹、程序与脚本使用简洁类型符号，演示内容与真实环境的无缩略图状态一致。
  const typeSymbols: Partial<Record<DemoMotif, string>> = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    script: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  };
  const symbol = typeSymbols[visual.motif];
  if (symbol) return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 32 32"><g transform="translate(4 4)" fill="none" stroke="#7c8996" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${symbol}</g></svg>`;
  const id = `g${hashPath(visual.from + visual.to).toString(36)}`;
  const h = hashPath(normalize(path));
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${h % 2 ? "1" : "0"}" y2="1">`
    + `<stop offset="0" stop-color="${visual.from}"/><stop offset="1" stop-color="${visual.to}"/>`
    + `</linearGradient></defs>`;
  const bg = `<rect width="960" height="640" fill="url(#${id})"/>`;
  let body: string;
  switch (visual.motif) {
    case "image": {
      // 风景：太阳位置/大小、波浪相位随路径哈希变化；太阳不撞右上角星标位
      const sunCx = 120 + (h % 520);
      const sunCy = 84 + ((h >> 3) % 72);
      const sunR = 48 + ((h >> 6) % 40);
      const waves = [
        [
          `<path d="M0 420 C180 360 280 480 480 400 C680 320 780 460 960 380 L960 640 L0 640 Z" fill="#1f2937" opacity="0.35"/>`,
          `<path d="M0 480 C220 420 360 520 560 450 C740 390 860 500 960 460 L960 640 L0 640 Z" fill="#111827" opacity="0.45"/>`,
        ],
        [
          `<path d="M0 380 C160 440 320 340 520 420 C700 492 800 380 960 430 L960 640 L0 640 Z" fill="#1f2937" opacity="0.35"/>`,
          `<path d="M0 460 C240 520 380 430 580 500 C760 560 860 470 960 510 L960 640 L0 640 Z" fill="#111827" opacity="0.45"/>`,
        ],
        [
          `<path d="M0 440 C200 380 340 500 520 410 C700 330 820 470 960 400 L960 640 L0 640 Z" fill="#1f2937" opacity="0.38"/>`,
          `<path d="M0 520 C180 470 400 560 600 490 C780 430 880 540 960 500 L960 640 L0 640 Z" fill="#111827" opacity="0.45"/>`,
        ],
      ][h % 3];
      body = `<circle cx="${sunCx}" cy="${sunCy}" r="${sunR}" fill="#ffe8b0"/>`
        + waves[0] + waves[1];
      break;
    }
    case "video": {
      // 胶片：上下齿孔条 + 中央播放钮——占位也读得出「这是视频」
      const holes = Array.from({ length: 8 }, (_, i) =>
        `<rect x="${52 + i * 112}" y="26" width="56" height="36" rx="6" fill="#ffffff" opacity="0.28"/>`
        + `<rect x="${52 + i * 112}" y="578" width="56" height="36" rx="6" fill="#ffffff" opacity="0.28"/>`,
      ).join("");
      body = `<rect width="960" height="640" fill="#0f172a" opacity="0.35"/>`
        + `<rect width="960" height="88" fill="#111827" opacity="0.55"/>`
        + `<rect y="552" width="960" height="88" fill="#111827" opacity="0.55"/>`
        + holes
        + `<circle cx="480" cy="320" r="72" fill="#111827" opacity="0.6"/>`
        + `<polygon points="466,284 466,356 528,320" fill="#ffffff"/>`;
      break;
    }
    case "audio": {
      // 均衡器：柱高随路径哈希起伏
      const bars = Array.from({ length: 9 }, (_, i) => {
        const bh = 110 + ((h >> (i % 8)) % 200);
        return `<rect x="${168 + i * 78}" y="${500 - bh}" width="44" height="${bh}" rx="14" fill="#ffffff" opacity="${i % 2 ? 0.5 : 0.32}"/>`;
      }).join("");
      body = bars;
      break;
    }
    case "folder": {
      body = `<circle cx="810" cy="120" r="150" fill="#ffffff" opacity="0.10"/>`
        + `<path d="M230 210 h170 l46 54 h284 a34 34 0 0 1 34 34 v216 a34 34 0 0 1 -34 34 H230 a34 34 0 0 1 -34 -34 V244 a34 34 0 0 1 34 -34 Z" fill="#111827" opacity="0.30"/>`
        + `<path d="M196 264 h568 v250 a34 34 0 0 1 -34 34 H230 a34 34 0 0 1 -34 -34 Z" fill="#ffffff" opacity="0.16"/>`;
      break;
    }
    case "app": {
      body = `<circle cx="150" cy="520" r="170" fill="#000000" opacity="0.10"/>`
        + `<rect x="240" y="130" width="480" height="380" rx="28" fill="#111827" opacity="0.30"/>`
        + `<path d="M240 158 a28 28 0 0 1 28 -28 h424 a28 28 0 0 1 28 28 v34 H240 Z" fill="#ffffff" opacity="0.25"/>`
        + `<circle cx="278" cy="158" r="9" fill="#ffffff" opacity="0.7"/>`
        + `<circle cx="308" cy="158" r="9" fill="#ffffff" opacity="0.7"/>`
        + `<circle cx="338" cy="158" r="9" fill="#ffffff" opacity="0.7"/>`
        + `<rect x="292" y="262" width="290" height="32" rx="10" fill="#ffffff" opacity="0.62"/>`
        + `<rect x="292" y="326" width="210" height="24" rx="9" fill="#ffffff" opacity="0.35"/>`
        + `<rect x="292" y="376" width="260" height="24" rx="9" fill="#ffffff" opacity="0.35"/>`;
      break;
    }
    case "script": {
      body = `<rect x="220" y="150" width="520" height="340" rx="20" fill="#0f172a" opacity="0.72"/>`
        + `<path d="M220 170 a20 20 0 0 1 20 -20 h480 a20 20 0 0 1 20 20 v26 H220 Z" fill="#1f2937" opacity="0.85"/>`
        + `<circle cx="256" cy="173" r="8" fill="#f87171"/>`
        + `<circle cx="284" cy="173" r="8" fill="#fbbf24"/>`
        + `<circle cx="312" cy="173" r="8" fill="#34d399"/>`
        + `<text x="272" y="330" font-size="110" font-family="monospace" fill="#e2e8f0" opacity="0.9">&gt;_</text>`;
      break;
    }
    default: {
      body = `<path d="M360 130 h180 l80 90 v290 a20 20 0 0 1 -20 20 H360 a20 20 0 0 1 -20 -20 V150 a20 20 0 0 1 20 -20 Z" fill="#ffffff" opacity="0.25"/>`
        + `<rect x="388" y="320" width="184" height="28" rx="9" fill="#ffffff" opacity="0.52"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">${defs}${bg}${body}</svg>`;
}

function buildSvg(visual: DemoVisual, path: string): string {
  if (visual.motif !== "file" || /\.(jpe?g|png|webp|gif|bmp|mp4|m4v|mkv|avi|mov|wmv|flv|webm|mp3|flac|wav|ogg|m4a|aac|exe|lnk|bat|cmd|ps1|sh)$/i.test(path)) {
    return buildScene(visual, path);
  }
  const id = `g${hashPath(visual.from + visual.to).toString(36)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${visual.from}"/><stop offset="1" stop-color="${visual.to}"/>`
    + `</linearGradient></defs>`
    + `<rect width="512" height="512" rx="96" fill="url(#${id})"/>`
    + `<circle cx="396" cy="116" r="180" fill="#ffffff" opacity="0.10"/>`
    + `<circle cx="96" cy="420" r="140" fill="#000000" opacity="0.08"/>`
    + `<path d="M148 176 h146 l70 70 v164 a20 20 0 0 1 -20 20 H148 a20 20 0 0 1 -20 -20 V196 a20 20 0 0 1 20 -20 Z" fill="#ffffff" opacity="0.34"/>`
    + `</svg>`;
}

/**
 * demo 版 convertFileSrc：任意路径 → 内联 SVG data URL。
 * 真实环境由 Tauri 把磁盘路径转为 asset: URL；demo 环境无磁盘文件，
 * 改为程序化生成确定性、按类型可辨的占位图。
 */
export function demoAssetUrl(path: string): string {
  const svg = buildSvg(lookupVisual(path), path);
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

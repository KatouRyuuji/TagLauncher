// ============================================================================
// demo/tauri/core.ts — @tauri-apps/api/core 的 demo 替身
// ============================================================================
// demo 模式（vite --mode demo）下由 vite.config.ts 的 resolve.alias 把
// @tauri-apps/api/core 指向本文件：invoke 路由到内存演示后端，
// convertFileSrc 把虚构路径映射为程序化生成的 SVG data URL。
// ============================================================================

import { demoAssetUrl, demoSilentAudioUrl } from "../assets";
import { handleInvoke } from "../backend";

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return handleInvoke<T>(cmd, args);
}

export function convertFileSrc(path: string): string {
  // <audio> 元素需要真实可解码的音频流，喂静音 WAV 而非 SVG 占位图
  if (/\.(mp3|flac|wav|ogg|m4a|aac)$/i.test(path)) return demoSilentAudioUrl();
  return demoAssetUrl(path);
}

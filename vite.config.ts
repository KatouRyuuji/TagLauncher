import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  resolve:
    mode === "demo"
      ? {
          // demo 模式：Tauri API 全部替换为浏览器内 mock（见 src/demo/），
          // 使应用无需 Rust 后端即可运行，用于功能演示与自动截图。
          alias: {
            "@tauri-apps/api/core": r("./src/demo/tauri/core.ts"),
            "@tauri-apps/api/window": r("./src/demo/tauri/window.ts"),
            "@tauri-apps/api/webview": r("./src/demo/tauri/webview.ts"),
            "@tauri-apps/plugin-dialog": r("./src/demo/tauri/dialog.ts"),
            "@tauri-apps/plugin-shell": r("./src/demo/tauri/shell.ts"),
          },
        }
      : undefined,
  server: {
    port: 3456,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // 桌面应用从本地磁盘加载，无网络/CDN 缓存收益；拆包不会降低启动实际工作量
    // （pinyin-pro 词典等始终需要）。故不做 code-split，仅上调告警阈值消除噪声。
    chunkSizeWarningLimit: 1200,
  },
}));

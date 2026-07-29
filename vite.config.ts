import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
});

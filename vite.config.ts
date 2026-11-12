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
            "@tauri-apps/plugin-window-state": r("./src/demo/tauri/windowState.ts"),
          },
        }
      : undefined,
  // 两个页面：主窗 index.html、全局快速搜索窗 quick.html（共享搜索代码分片）
  build: {
    rollupOptions: {
      input: { main: r("./index.html"), quick: r("./quick.html") },
    },
  },
  server: {
    port: 3456,
    strictPort: true,
    fs: {
      // worktree 的 node_modules 是指向主工作树的符号链接，需放行真实路径才能加载字体
      allow: [r("."), r(".."), "/workspace/TagLauncher", "/tmp/ui-var"],
    },
    watch: {
      ignored: ["**/src-tauri/**", "**/.tmp-test/**", "**/.workflow/**"],
    },
  },
}));

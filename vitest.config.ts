import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// ============================================================================
// vitest.config.ts — 前端交互测试配置
// ============================================================================
// 覆盖 .spec.ts / .spec.tsx 文件，使用 jsdom 环境模拟浏览器，
// 与 Vite + React + Tailwind 构建链路保持一致。
// Tauri 后端调用在测试中统一 mock，避免依赖 WebView 运行环境。
// ============================================================================

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // 与现有 esbuild + node 纯逻辑测试区分：.test.ts / .design.test.ts 仍由 run-tests.mjs 执行
    exclude: ["src/**/*.test.ts", "src/**/*.design.test.ts", "node_modules", "dist", ".tmp-test"],
    setupFiles: ["src/test/setup.ts"],
    // Node ≥22 开启实验性 webstorage 时会占住 global.localStorage；vitest 的 populateGlobal
    // 因此跳过注入 jsdom Storage，表现为 localStorage 为 undefined / 无 --localstorage-file 报错。
    // 关闭该实验特性，让 jsdom 的 Storage 正常挂到测试全局。
    execArgv: ["--no-experimental-webstorage"],
  },
});

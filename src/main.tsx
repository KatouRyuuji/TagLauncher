// ============================================================================
// main.tsx — React 应用入口
// ============================================================================
// 创建 React 根节点并挂载 App 组件。
// StrictMode 在开发模式下会额外检查潜在问题（如副作用重复执行）。
// ============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
// 本地打包字体（OFL）：UI = Noto Sans SC（可变字重）、正文 = LXGW WenKai（仅 regular，
// 约 4.6MB 分片按 unicode-range 按需加载）、等宽 = Cascadia Code（latin 子集）
import "@fontsource-variable/noto-sans-sc";
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import "@fontsource/cascadia-code/latin-400.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

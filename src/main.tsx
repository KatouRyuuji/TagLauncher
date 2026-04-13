// ============================================================================
// main.tsx — React 应用入口
// ============================================================================
// 创建 React 根节点并挂载 App 组件。
// StrictMode 在开发模式下会额外检查潜在问题（如副作用重复执行）。
// ============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

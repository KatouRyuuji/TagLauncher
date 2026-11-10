// 快速搜索窗入口（quick.html）。与主窗同一份样式与搜索代码，不加载主窗的 App。
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "../index.css";
import "./quick.css";
import { QuickApp } from "./QuickApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QuickApp />
  </React.StrictMode>,
);

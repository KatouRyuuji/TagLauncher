// 快速搜索窗入口（quick.html）。与主窗同一份搜索代码；不加载主窗的 App、Tailwind 样式与打包字体
// （隐藏常驻内存有上限：5k ≤ 60MB / 50k ≤ 120MB），只用主题变量 + 自己的小样式表，字体走系统中文字体。
import React from "react";
import ReactDOM from "react-dom/client";
import "./quick.css";
import { QuickApp } from "./QuickApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QuickApp />
  </React.StrictMode>,
);

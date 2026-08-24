// ============================================================================
// src/test/setup.ts — vitest 测试全局初始化
// ============================================================================
// 注册 @testing-library/jest-dom 自定义匹配器，并提供 Tauri API 的最小 mock，
// 使组件/ hook 测试无需真实 WebView 即可运行。
// ============================================================================

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Tauri core API mock：避免测试中调用真实 WebView 接口
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    show: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// 全局测试用工具，供测试文件直接读取
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

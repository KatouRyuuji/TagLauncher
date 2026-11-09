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
  convertFileSrc: (path: string) => path,
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

// Node ≥22 实验性 localStorage 可能占住全局键，导致 jsdom Storage 未被 vitest 注入。
// execArgv 已关 webstorage；此处再兜底，避免个别 runner 未把 execArgv 传到 worker。
(() => {
  const usable = (value: unknown): value is Storage =>
    !!value
    && typeof (value as Storage).getItem === "function"
    && typeof (value as Storage).setItem === "function"
    && typeof (value as Storage).clear === "function";
  if (usable(globalThis.localStorage)) return;
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key) { return store.has(key) ? store.get(key)! : null; },
    key(index) { return [...store.keys()][index] ?? null; },
    removeItem(key) { store.delete(key); },
    setItem(key, value) { store.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    enumerable: true,
    writable: true,
  });
})();


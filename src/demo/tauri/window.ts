// ============================================================================
// demo/tauri/window.ts — @tauri-apps/api/window 的 demo 替身
// ============================================================================
// 浏览器中没有原生窗口，窗口操作全部退化为无副作用的 no-op；
// 事件订阅返回 unlisten 函数，保证宿主代码的清理逻辑照常执行。
// ============================================================================

type UnlistenFn = () => void;

function subscribe(): Promise<UnlistenFn> {
  return Promise.resolve(() => {});
}

const demoWindow = {
  label: "main",
  minimize: () => Promise.resolve(),
  unminimize: () => Promise.resolve(),
  maximize: () => Promise.resolve(),
  unmaximize: () => Promise.resolve(),
  toggleMaximize: () => Promise.resolve(),
  isMaximized: () => Promise.resolve(false),
  isMinimized: () => Promise.resolve(false),
  isVisible: () => Promise.resolve(true),
  isFocused: () => Promise.resolve(true),
  show: () => Promise.resolve(),
  hide: () => Promise.resolve(),
  close: () => Promise.resolve(),
  destroy: () => Promise.resolve(),
  setFocus: () => Promise.resolve(),
  startDragging: () => Promise.resolve(),
  setTitle: () => Promise.resolve(),
  title: () => Promise.resolve("TagLauncher"),
  theme: () => Promise.resolve("dark"),
  scaleFactor: () => Promise.resolve(1),
  innerSize: () => Promise.resolve({ width: 1440, height: 900, type: "Logical" }),
  outerSize: () => Promise.resolve({ width: 1440, height: 900, type: "Physical" }),
  innerPosition: () => Promise.resolve({ x: 0, y: 0, type: "Physical" }),
  outerPosition: () => Promise.resolve({ x: 0, y: 0, type: "Physical" }),
  onDragDropEvent: subscribe,
  onResized: subscribe,
  onMoved: subscribe,
  onCloseRequested: subscribe,
  onFocusChanged: subscribe,
  onScaleChanged: subscribe,
  onThemeChanged: subscribe,
  listen: subscribe,
  once: subscribe,
  emit: () => Promise.resolve(),
};

export function getCurrentWindow() {
  return demoWindow;
}

export function getAllWindows() {
  return [demoWindow];
}

export class Window {
  static getCurrent() {
    return demoWindow;
  }
}

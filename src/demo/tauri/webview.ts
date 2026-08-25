// ============================================================================
// demo/tauri/webview.ts — @tauri-apps/api/webview 的 demo 替身
// ============================================================================
// 浏览器环境中原生拖拽事件由 DOM drag & drop 通道兜底（宿主本就双通道），
// 此处只需让 onDragDropEvent 订阅安全成立并返回 unlisten。
// ============================================================================

type UnlistenFn = () => void;

const demoWebview = {
  label: "main",
  onDragDropEvent: (): Promise<UnlistenFn> => Promise.resolve(() => {}),
  listen: (): Promise<UnlistenFn> => Promise.resolve(() => {}),
  once: (): Promise<UnlistenFn> => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
};

export function getCurrentWebview() {
  return demoWebview;
}

export function getAllWebviews() {
  return [demoWebview];
}

export class Webview {
  static getCurrent() {
    return demoWebview;
  }
}

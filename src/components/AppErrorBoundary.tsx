// ============================================================================
// components/AppErrorBoundary.tsx — 顶层 React 错误边界
// ============================================================================
// 捕获渲染期未处理异常，替代「整窗白屏」为可操作的错误页：
// - 展示错误摘要，提供「复制错误详情」与「重新加载」两个恢复动作；
// - 关键兜底：崩溃可能发生在 ThemeProvider 放行窗口显示之前（启动期窗口
//   visible: false），此时必须移除 FOUC 门控并强制 show()，否则用户面对的
//   是一个永远不可见的挂死进程；
// - 原生标题栏已关闭（decorations: false），错误页保留 TitleBar，用户仍可
//   拖动 / 最小化 / 关闭窗口。
// 样式仅依赖 index.css :root 的默认 token，不依赖主题系统是否就绪。
// ============================================================================

import { Component, type ErrorInfo, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "./TitleBar";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  copied: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary] 渲染崩溃:", error, errorInfo.componentStack);
    // 崩溃早于主题就绪时窗口仍不可见：移除门控并强制显示，避免进程挂死不可见
    document.documentElement.removeAttribute("data-app-preparing");
    void getCurrentWindow().show().catch(() => {});
  }

  // 不走 lib/clipboard 的 copyText：其 toast 依赖已随崩溃卸载的 ToastContainer，
  // 错误页内改用按钮文案做内联反馈。
  private handleCopy = () => {
    const { error } = this.state;
    if (!error) return;
    navigator.clipboard
      .writeText(`${error.name}: ${error.message}\n${error.stack ?? ""}`)
      .then(() => {
        this.setState({ copied: true });
        window.setTimeout(() => this.setState({ copied: false }), 2000);
      })
      .catch(() => {});
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div data-region="root" className="select-none" style={{ fontFamily: "var(--font-family)" }}>
        <TitleBar />
        <div className="flex flex-1 items-center justify-center overflow-auto p-6">
          <div className="modal-surface w-full max-w-[520px] p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">界面发生了意外错误</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              你的数据未受影响。可以尝试重新加载界面；若问题反复出现，请复制错误详情反馈。
            </p>
            <p className="mt-4 max-h-32 overflow-auto rounded-[var(--radius-md)] bg-[var(--bg-input)] px-3 py-2 text-left font-[family-name:var(--font-family-mono)] text-xs text-[var(--text-tertiary)]">
              {error.name}: {error.message}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button type="button" className="action-button" onClick={this.handleCopy}>
                {copied ? "已复制" : "复制错误详情"}
              </button>
              <button type="button" className="action-button action-button-primary" onClick={this.handleReload}>
                重新加载
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

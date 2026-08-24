// ============================================================================
// components/TitleBar.tsx — 自绘窗口标题栏（原生装饰已关闭）
// ============================================================================
// tauri.conf.json 中 decorations: false 隐藏了 Windows 原生标题栏，本组件
// 提供替代的窗口栏：
// - data-tauri-drag-region 声明可拖拽区域（Tauri 原生处理拖拽 + 双击最大化）；
// - 最小化 / 最大化(还原) / 关闭 三个窗口控制按钮（权限见 capabilities/default.json）；
// - 最大化状态经 onResized 事件同步，图标在「最大化 / 还原」间切换；
// - 全部颜色取自主题 token（--bg-surface / --border-subtle / --bg-hover 等），
//   随主题系统（内置 / 自定义 JSON / Mod 主题）自动生效。
// 非 Tauri 环境（vitest / 浏览器）下所有窗口调用均静默失败，不影响渲染。
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
// 32x32 小图标（与 src-tauri/icons/32x32.png 同源）：完整 icon.png 有 1.5MB，
// 作为 16px 窗口栏图标会无谓膨胀前端包体
import appIcon from "../assets/icon-32.png";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  // 同步最大化状态：初始查询一次 + 监听窗口尺寸变化（拖拽边缘、Win+方向键、
  // 双击标题栏等所有途径都会触发 onResized，无需逐一拦截）。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();

    const syncMaximized = () => {
      win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {});
    };

    syncMaximized();
    win
      .onResized(syncMaximized)
      .then((fn) => {
        // 组件已卸载时立即释放监听，避免泄漏
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleMinimize = useCallback(() => {
    void getCurrentWindow().minimize().catch(() => {});
  }, []);

  const handleToggleMaximize = useCallback(() => {
    void getCurrentWindow().toggleMaximize().catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    void getCurrentWindow().close().catch(() => {});
  }, []);

  return (
    <header data-region="titlebar" data-tauri-drag-region>
      {/* 左侧品牌区：pointer-events 关闭使 mousedown 落在带 drag-region 的 header 上 */}
      <div className="pointer-events-none flex min-w-0 items-center gap-2 pl-3">
        <img src={appIcon} alt="" className="h-4 w-4 shrink-0" draggable={false} />
        <span className="truncate text-xs font-medium tracking-wide text-[var(--text-muted)]">
          TagLauncher
        </span>
      </div>

      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={handleMinimize}
          className="titlebar-control"
          title="最小化"
          aria-label="最小化"
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
            <path d="M0.5 5h9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="titlebar-control"
          title={maximized ? "还原" : "最大化"}
          aria-label={maximized ? "还原" : "最大化"}
        >
          {maximized ? (
            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
              <path d="M2.5 2.5v-2h7v7h-2" />
              <rect x="0.5" y="2.5" width="7" height="7" />
            </svg>
          ) : (
            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="titlebar-control titlebar-control-close"
          title="关闭"
          aria-label="关闭"
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}

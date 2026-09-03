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
import { Copy, Menu, Minus, Moon, Square, Sun, X } from "lucide-react";
// 32x32 小图标（与 src-tauri/icons/32x32.png 同源）：完整 icon.png 有 1.5MB，
// 作为窗口栏图标会无谓膨胀前端包体
import appIcon from "../assets/icon-32.png";
import { useThemeContextOptional } from "./ThemeProvider";
import { findFamilyByThemeId } from "../themes";

export function TitleBar({
  sidebarOpen = false,
  onToggleSidebar,
}: {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  // 亮/暗快捷开关：仅内置配色家族随模式换肤（自定义/Mod 主题自带配色）；
  // 脱离 Provider（单元测试）时开关隐藏
  const themeContext = useThemeContextOptional();
  const effectiveMode = themeContext?.effectiveMode ?? "light";
  const modeToggleEnabled =
    themeContext !== null && findFamilyByThemeId(themeContext.currentTheme.id) !== undefined;

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
      <div className="flex min-w-0 items-center self-stretch">
        {onToggleSidebar && (
          <button
            type="button"
            className="titlebar-control titlebar-mobile-toggle"
            aria-label={sidebarOpen ? "关闭资源导航" : "打开资源导航"}
            aria-expanded={sidebarOpen}
            aria-controls="workspace-sidebar"
            onClick={onToggleSidebar}
          >
            <Menu aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        )}
        {/* 品牌区关闭 pointer-events，使 mousedown 落在带 drag-region 的 header 上。
            与侧栏品牌区同一规格：icon 底与文字基线底部对齐（items-end）。 */}
        <div className="pointer-events-none flex min-w-0 items-center self-stretch pl-3">
        <div className="flex min-w-0 items-end gap-2.5 pb-[7px] pr-3">
          <img src={appIcon} alt="" className="h-[26px] w-[26px] shrink-0" draggable={false} />
          <span className="truncate pb-px text-[14px] font-semibold leading-4 text-[var(--text-primary)]">
            TagLauncher
          </span>
        </div>
        </div>
      </div>

      <div className="flex h-full shrink-0 items-stretch">
        {themeContext && (
          <button
            type="button"
            onClick={() => themeContext.changeColorMode(effectiveMode === "dark" ? "light" : "dark")}
            disabled={!modeToggleEnabled}
            className="titlebar-control"
            title={
              modeToggleEnabled
                ? effectiveMode === "dark"
                  ? "切换到亮色模式"
                  : "切换到暗色模式"
                : "当前主题自带配色，亮/暗切换仅对内置主题生效"
            }
            aria-label={effectiveMode === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
          >
            {effectiveMode === "dark" ? (
              <Sun className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Moon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={handleMinimize}
          className="titlebar-control"
          title="最小化"
          aria-label="最小化"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="titlebar-control"
          title={maximized ? "还原" : "最大化"}
          aria-label={maximized ? "还原" : "最大化"}
        >
          {maximized ? (
            <Copy className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Square className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="titlebar-control titlebar-control-close"
          title="关闭"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

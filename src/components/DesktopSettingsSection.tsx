import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import {
  captureShortcut,
  DESKTOP_SETTINGS_CHANGED_EVENT,
  formatShortcut,
  type CloseAction,
  type DesktopSettings,
  type HotkeyAction,
  type HotkeyInfo,
  type QuickMonitor,
  type QuickOptions,
} from "../lib/desktopShortcut";
import { showToast } from "../lib/toast";
import { SettingsToggle } from "./SettingsField";
import { ShellIntegrationSection } from "./ShellIntegrationSection";
import { Win11MenuSection } from "./Win11MenuSection";

const CLOSE_OPTIONS: Array<{ value: CloseAction; label: string; hint: string }> = [
  { value: "exit", label: "退出程序", hint: "点关闭即退出（默认）。程序退出后全局快捷键随之失效" },
  { value: "tray", label: "最小化到托盘", hint: "点关闭只隐藏窗口，从托盘图标或全局快捷键唤回；托盘菜单「退出」才真正退出" },
];

const QUICK_MONITOR_OPTIONS: Array<{ value: QuickMonitor; label: string; hint: string }> = [
  { value: "cursor", label: "鼠标所在显示器", hint: "在哪块屏幕操作就在哪块屏幕弹出（默认）" },
  { value: "main", label: "主窗所在显示器", hint: "始终跟随主窗口所在的屏幕" },
];

/** 各动作的补充说明（按动作，不按顺序） */
const HOTKEY_HINTS: Partial<Record<HotkeyAction, string>> = {
  collect_selection: "在资源管理器或桌面选中文件后按下，弹出收纳窗；前台没有选中项时，改为收纳剪贴板里复制的文件。",
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function HotkeyRow({ info, disabled, onApply }: {
  info: HotkeyInfo;
  disabled: boolean;
  onApply: (action: HotkeyAction, next: string | null) => Promise<string | null>;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(info.error);
  useEffect(() => setError(info.error), [info.error]);
  const current = info.accelerator;
  const apply = async (next: string | null) => setError(await onApply(info.action, next));

  return (
    <div data-hotkey-action={info.action}>
      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">{info.label}</span>
      {HOTKEY_HINTS[info.action] && (
        <span data-testid={`hotkey-hint-${info.action}`} className="mb-1.5 block text-xs leading-5 text-[var(--text-secondary)]">
          {HOTKEY_HINTS[info.action]}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid={`hotkey-value-${info.action}`}
          className="inline-flex h-10 min-w-[10rem] items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)]"
        >
          {recording ? "请按下组合键（Esc 取消）…" : current ? formatShortcut(current) : "未启用"}
        </span>
        <button
          type="button"
          className="action-button"
          disabled={disabled}
          aria-pressed={recording}
          aria-label={`${recording ? "取消录制" : current ? "重新录制" : "录制快捷键"}：${info.label}`}
          onClick={() => {
            setError(null);
            setRecording((value) => !value);
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            if (!recording) return;
            event.preventDefault();
            event.stopPropagation();
            const result = captureShortcut(event);
            if (result.kind === "pending") return;
            setRecording(false);
            if (result.kind === "cancel") return;
            if (result.kind === "invalid") {
              setError(result.message);
              return;
            }
            void apply(result.accelerator);
          }}
        >
          {recording ? "取消录制" : current ? "重新录制" : "录制快捷键"}
        </button>
        {current && (
          <button type="button" className="action-button" disabled={disabled} aria-label={`清除：${info.label}`} onClick={() => void apply(null)}>
            清除
          </button>
        )}
      </div>
      {error && (
        <p role="alert" data-testid={`hotkey-error-${info.action}`} className="mt-1.5 text-sm text-[var(--color-danger-ink)]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * 设置 → 桌面驻留（F18）：「动作 → 快捷键」表（默认都不启用）、关闭窗口行为（默认退出）、
 * 全屏时忽略热键。设置只由后端持有：注册失败/冲突时后端保持旧值并报错，这里显示错误，不静默吞掉；
 * 托盘或其他入口改了设置时经 desktop-settings-changed 事件同步。
 */
export function DesktopSettingsSection() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void db.getDesktopSettings().then((value) => {
      if (!disposed) setSettings(value);
    }).catch((e) => setLoadError(`读取桌面设置失败：${errorText(e)}`));
    let unlisten: (() => void) | undefined;
    void Promise.resolve()
      .then(() => listen<DesktopSettings>(DESKTOP_SETTINGS_CHANGED_EVENT, (event) => setSettings(event.payload)))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const applyHotkey = async (action: HotkeyAction, next: string | null): Promise<string | null> => {
    setBusy(true);
    try {
      setSettings(await db.setHotkey(action, next));
      showToast(next ? `已启用全局快捷键 ${formatShortcut(next)}` : "已关闭该全局快捷键", "success");
      return null;
    } catch (e) {
      // 后端已回滚到旧值；重新读取以显示真实状态
      void db.getDesktopSettings().then(setSettings).catch(() => {});
      return errorText(e);
    } finally {
      setBusy(false);
    }
  };

  const applyCloseAction = async (action: CloseAction) => {
    if (!settings || settings.closeAction === action) return;
    setBusy(true);
    setCloseError(null);
    try {
      setSettings(await db.setCloseAction(action));
    } catch (e) {
      setCloseError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const applyIgnoreFullscreen = async (enabled: boolean) => {
    setBusy(true);
    try {
      setSettings(await db.setHotkeyIgnoreFullscreen(enabled));
    } catch (e) {
      showToast(`保存失败：${errorText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const applyQuickOptions = async (patch: Partial<QuickOptions>) => {
    if (!settings) return;
    setBusy(true);
    try {
      setSettings(await db.setQuickOptions({ ...settings.quick, ...patch }));
    } catch (e) {
      showToast(`保存失败：${errorText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const anyHotkey = settings?.hotkeys.some((h) => h.accelerator) ?? false;

  return (
    <section className="surface-card-soft mt-6 p-5">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">桌面驻留</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        全局快捷键与关闭窗口行为。默认不占用任何按键，也不会开机自启。全局功能需要程序在后台常驻。
      </p>
      {loadError && <p role="alert" className="mt-2 text-sm text-[var(--color-danger-ink)]">{loadError}</p>}

      <div className="mt-4 space-y-4">
        <span className="instrument-label block">全局快捷键</span>
        {settings?.hotkeys.map((info) => (
          <HotkeyRow key={info.action} info={info} disabled={busy} onApply={applyHotkey} />
        ))}
        <p className="text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
          需包含 Ctrl、Alt 或 Win；在任意程序里按下即可执行对应动作。
        </p>
        {settings && (
          <SettingsToggle
            checked={settings.ignoreFullscreen}
            disabled={busy}
            onChange={(checked) => void applyIgnoreFullscreen(checked)}
            title="全屏时忽略全局快捷键"
            description="前台程序全屏（游戏、演示、视频）时不响应，避免误触；2 秒内连按 3 次仍可强制唤出。"
          />
        )}
      </div>

      {settings && (
        <div data-testid="quick-options" className="mt-5 space-y-3">
          <span className="instrument-label block">快速搜索窗</span>
          <SettingsToggle
            checked={settings.quick.hideOnBlur}
            disabled={busy}
            onChange={(checked) => void applyQuickOptions({ hideOnBlur: checked })}
            title="失去焦点时自动隐藏"
            description="点到别的窗口时收起快速窗；关闭后需按 Esc 或再次按快捷键收起。"
          />
          <SettingsToggle
            checked={settings.quick.keepInput}
            disabled={busy}
            onChange={(checked) => void applyQuickOptions({ keepInput: checked })}
            title="保留上次输入"
            description="唤出时保留上次的搜索词并全选（直接打字即替换）；关闭后每次唤出都是空白输入框。"
          />
          <div role="radiogroup" aria-label="快速窗唤出位置" className="grid gap-2 sm:grid-cols-2">
            {QUICK_MONITOR_OPTIONS.map((option) => {
              const active = settings.quick.monitor === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => void applyQuickOptions({ monitor: option.value })}
                  className={`rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)]"
                      : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5">
        <span className="instrument-label mb-2 block">关闭窗口时</span>
        <div role="radiogroup" aria-label="关闭窗口时" className="grid gap-2 sm:grid-cols-2">
          {CLOSE_OPTIONS.map((option) => {
            const active = settings?.closeAction === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy || !settings}
                onClick={() => void applyCloseAction(option.value)}
                className={`rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)]"
                    : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">{option.hint}</span>
              </button>
            );
          })}
        </div>
        {settings?.closeAction === "exit" && anyHotkey && (
          <p data-testid="close-exit-warning" className="mt-1.5 text-sm text-[var(--color-warning-ink)]">
            当前选择「退出程序」：关闭窗口后程序退出，全局快捷键随之失效。需要随时唤出请选「最小化到托盘」。
          </p>
        )}
        {closeError && (
          <p role="alert" className="mt-1.5 text-sm text-[var(--color-danger-ink)]">
            {closeError}
          </p>
        )}
      </div>
      <ShellIntegrationSection disabled={busy} />
      <Win11MenuSection disabled={busy} />
    </section>
  );
}

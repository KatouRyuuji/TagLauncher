import { useEffect, useState } from "react";
import * as db from "../lib/db";
import { captureShortcut, formatShortcut, type CloseAction, type DesktopSettings } from "../lib/desktopShortcut";
import { showToast } from "../lib/toast";

const CLOSE_OPTIONS: Array<{ value: CloseAction; label: string; hint: string }> = [
  { value: "exit", label: "退出程序", hint: "点关闭即退出（默认）" },
  { value: "tray", label: "最小化到托盘", hint: "点关闭只隐藏窗口，从托盘图标或全局快捷键唤回；托盘菜单「退出」才真正退出" },
];

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 设置 → 桌面驻留（F18）：全局唤起快捷键（默认不启用）与关闭窗口行为（默认退出）。
 * 后端注册失败/冲突会保持旧值并报错，这里把错误显示在控件下方，不静默吞掉。
 */
export function DesktopSettingsSection() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    void db.getDesktopSettings().then((value) => {
      setSettings(value);
      setShortcutError(value.shortcutError);
    }).catch((e) => setShortcutError(`读取桌面设置失败：${errorText(e)}`));
  }, []);

  const applyShortcut = async (next: string | null) => {
    setBusy(true);
    setShortcutError(null);
    try {
      const value = await db.setGlobalShortcut(next);
      setSettings(value);
      showToast(next ? `已启用全局快捷键 ${formatShortcut(next)}` : "已关闭全局快捷键", "success");
    } catch (e) {
      // 后端已回滚到旧值；重新读取以显示真实状态
      setShortcutError(errorText(e));
      void db.getDesktopSettings().then(setSettings).catch(() => {});
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

  const current = settings?.globalShortcut ?? null;

  return (
    <section className="surface-card-soft mt-6 p-5">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">桌面驻留</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">全局唤起快捷键与关闭窗口行为。默认不占用任何按键，也不会开机自启。</p>

      <div className="mt-4">
        <span className="instrument-label mb-2 block">全局唤起快捷键</span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="global-shortcut-value"
            className="inline-flex h-10 min-w-[10rem] items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)]"
          >
            {recording ? "请按下组合键（Esc 取消）…" : current ? formatShortcut(current) : "未启用"}
          </span>
          <button
            type="button"
            className="action-button"
            disabled={busy || !settings}
            aria-pressed={recording}
            onClick={() => {
              setShortcutError(null);
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
                setShortcutError(result.message);
                return;
              }
              void applyShortcut(result.accelerator);
            }}
          >
            {recording ? "取消录制" : current ? "重新录制" : "录制快捷键"}
          </button>
          {current && (
            <button type="button" className="action-button" disabled={busy} onClick={() => void applyShortcut(null)}>
              清除
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
          需包含 Ctrl、Alt 或 Win；在任意程序里按下即可唤起或收起 TagLauncher。
        </p>
        {shortcutError && (
          <p role="alert" data-testid="global-shortcut-error" className="mt-1.5 text-sm text-[var(--color-danger-ink)]">
            {shortcutError}
          </p>
        )}
      </div>

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
        {closeError && (
          <p role="alert" className="mt-1.5 text-sm text-[var(--color-danger-ink)]">
            {closeError}
          </p>
        )}
      </div>
    </section>
  );
}

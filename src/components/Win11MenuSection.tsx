import { useEffect, useState } from "react";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";
import { SettingsToggle } from "./SettingsField";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 设置 → 桌面驻留 → Win11 一级右键菜单（实验，默认关闭）。与经典菜单（ShellIntegrationSection）独立，
 * 可同时开启。开关表示意图；「已注册」以系统实际状态为准，意图开但未注册时提示重新注册。
 * 不支持（Win10 / 构建未附带组件）时只显示原因，不渲染开关。
 */
export function Win11MenuSection({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<db.Win11MenuStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    void db.getWin11Menu().then((s) => { if (!disposed) setStatus(s); }).catch((e) => { if (!disposed) setError(errorText(e)); });
    return () => { disposed = true; };
  }, []);

  const apply = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await db.setWin11Menu(enabled);
      setStatus(next);
      showToast(enabled ? "已在 Win11 一级右键菜单加入「用 TagLauncher 收纳」" : "已移除 Win11 一级右键菜单", "success");
    } catch (e) {
      setError(errorText(e));
      void db.getWin11Menu().then(setStatus).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.supported) {
    return (
      <p data-testid="win11-menu-unsupported" className="mt-3 text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
        Win11 一级右键菜单：{status.reason ?? "不可用"}
      </p>
    );
  }
  const stale = Boolean(status?.enabled && (!status.registered || status.registeredVersion !== status.bundledVersion));

  return (
    <div className="mt-4 space-y-2" data-testid="win11-menu">
      <SettingsToggle
        checked={Boolean(status?.enabled)}
        disabled={disabled || busy || !status}
        onChange={(checked) => void apply(checked)}
        title="Win11 一级右键菜单（实验）"
        description="把「用 TagLauncher 收纳」放进 Windows 11 新右键菜单的第一层，不用再点「显示更多选项」。以本机注册的未签名稀疏包实现：无需证书、管理员或开发者模式，不改系统全局设置；关闭或卸载时完整移除。可与上面的经典菜单同时开启。"
      />
      {busy && <p className="text-sm text-[var(--text-secondary)]">正在{status?.enabled ? "处理" : "注册"}…</p>}
      {stale && !busy && (
        <p data-testid="win11-menu-stale" className="text-sm text-[var(--color-warning-ink)]">
          {status?.registered ? `已注册的版本（${status.registeredVersion}）与当前程序（${status.bundledVersion}）不一致。` : "设置为开启，但系统里没有注册（可能被清理过）。"}
          <button type="button" className="action-button ml-2" disabled={busy} onClick={() => void apply(true)}>重新注册</button>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>}
      <p className="text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
        便携版删除程序目录前请先关闭此项；也可运行 <code>tag-launcher.exe --win11-menu remove</code> 清理。
      </p>
    </div>
  );
}

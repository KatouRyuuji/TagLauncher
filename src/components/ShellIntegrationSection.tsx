import { useEffect, useState } from "react";
import * as db from "../lib/db";
import { describeChoice, type CollectPreference } from "../lib/collect";
import { showToast } from "../lib/toast";
import type { Cabinet, Tag } from "../types";
import { SettingsToggle } from "./SettingsField";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 设置 → 桌面驻留 → 资源管理器右键菜单（阶段③）。默认关闭；状态以注册表实际情况为准：
 * 开启失败后端整体回滚，这里显示错误；便携版挪了位置时提示「修复为当前位置」。
 * 同时显示/清除收纳时「记住的选择」。
 */
export function ShellIntegrationSection({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<db.ShellIntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pref, setPref] = useState<CollectPreference | null>(null);
  const [names, setNames] = useState<{ tags: Tag[]; cabinets: Cabinet[] }>({ tags: [], cabinets: [] });

  useEffect(() => {
    let disposed = false;
    void db.getShellIntegration().then((s) => { if (!disposed) setStatus(s); }).catch((e) => setError(errorText(e)));
    void db.getCollectPreference().then((p) => { if (!disposed) setPref(p); }).catch(() => {});
    void Promise.all([db.getTags(), db.getCabinets()])
      .then(([tags, cabinets]) => { if (!disposed) setNames({ tags, cabinets }); })
      .catch(() => {});
    return () => { disposed = true; };
  }, []);

  const apply = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await db.setShellIntegration(enabled);
      setStatus(next);
      showToast(enabled ? "已添加右键菜单「用 TagLauncher 收纳…」与「发送到」" : "已移除右键菜单与「发送到」", "success");
    } catch (e) {
      setError(errorText(e));
      void db.getShellIntegration().then(setStatus).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const clearPref = async () => {
    try {
      setPref(await db.setCollectPreference(null));
    } catch (e) {
      showToast(`清除失败：${errorText(e)}`, "error");
    }
  };

  if (status && !status.supported) return null;
  const on = Boolean(status?.enabled || status?.partial);

  return (
    <div className="mt-5 space-y-2" data-testid="shell-integration">
      <span className="instrument-label block">资源管理器</span>
      <SettingsToggle
        checked={on}
        disabled={disabled || busy || !status}
        onChange={(checked) => void apply(checked)}
        title="右键菜单「用 TagLauncher 收纳…」"
        description="在文件、文件夹和文件夹空白处的右键菜单（Win11 在「显示更多选项」里）和「发送到」里加入收纳入口，选中后弹出快速窗选择打标签、放入文件柜或仅导入。关闭时完全移除。"
      />
      {status?.partial && (
        <p data-testid="shell-integration-partial" className="text-sm text-[var(--color-warning-ink)]">
          只注册了一部分（可能被手动删过）。
          <button type="button" className="action-button ml-2" disabled={busy} onClick={() => void apply(true)}>修复</button>
          <button type="button" className="action-button ml-2" disabled={busy} onClick={() => void apply(false)}>全部清理</button>
        </p>
      )}
      {status && on && !status.exeMatches && (
        <p data-testid="shell-integration-moved" className="text-sm text-[var(--color-warning-ink)]">
          右键菜单指向的程序位置（{status.registeredExe ?? "未知"}）与当前程序不一致，可能是便携版被挪动过。
          <button type="button" className="action-button ml-2" disabled={busy} onClick={() => void apply(true)}>修复为当前位置</button>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>}
      {pref && (
        <p data-testid="collect-preference" className="text-sm text-[var(--text-secondary)]">
          收纳时直接{describeChoice(pref, names.tags, names.cabinets)}（已记住）
          <button type="button" className="action-button ml-2" onClick={() => void clearPref()}>改为每次询问</button>
        </p>
      )}
      <p data-testid="shell-integration-limit" className="text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
        右键菜单一次最多选 100 项（Windows 限制，超过时菜单里不出现该项）；更多请用「发送到」或拖进快速窗，一次最多收纳 1000 项。
      </p>
      <p className="text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
        便携版删除程序目录前请先关闭此项；也可运行 <code>tag-launcher.exe --shell-integration remove</code> 清理。
      </p>
    </div>
  );
}

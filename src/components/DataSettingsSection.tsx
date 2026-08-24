import { useEffect, useState } from "react";
import { open as dialogOpen, save } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import * as db from "../lib/db";
import type { DataDirectoryInfo } from "../lib/db";
import { formatBytes } from "../lib/itemQuery";
import { showToast } from "../lib/toast";

type BusyAction = "switch" | "reset" | "backup" | "export" | "import" | null;

/** 后端 set_data_directory(migrate=true) 拒绝覆盖已有数据库时的错误特征串 */
const TARGET_HAS_DB_MARKER = "已存在 TagLauncher 数据库";

export function DataSettingsSection() {
  const [info, setInfo] = useState<DataDirectoryInfo | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  // 用户选择的目标目录已有数据库时挂起，展示「迁移覆盖被拒」的内联确认，
  // 提供"直接使用该目录数据"（migrate=false）入口——否则该场景是死路：
  // 后端报错文案引导的选择在前端不存在。
  const [pendingAdoptDir, setPendingAdoptDir] = useState<string | null>(null);

  const refresh = () => {
    void db
      .getDataDirectoryInfo()
      .then(setInfo)
      .catch((e) => showToast(`读取数据目录信息失败：${e instanceof Error ? e.message : String(e)}`, "error"));
  };

  useEffect(refresh, []);

  const withBusy = async (action: BusyAction, fn: () => Promise<void>) => {
    setBusy(action);
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const promptRestart = (message: string) => {
    showToast(message, "success");
    // 略微延迟，让用户看到 toast 后重启
    window.setTimeout(() => {
      void db.restartApp().catch(() => showToast("请手动重启应用以生效", "warning"));
    }, 1200);
  };

  const handleSwitchDir = () =>
    withBusy("switch", async () => {
      const selected = await dialogOpen({ title: "选择新的数据目录", directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;
      try {
        await db.setDataDirectory(selected, true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes(TARGET_HAS_DB_MARKER)) {
          // 转为内联确认：由用户选择"直接使用目标目录数据"或取消
          setPendingAdoptDir(selected);
          return;
        }
        throw e;
      }
      promptRestart("数据目录已切换，应用即将重启以生效");
    });

  // 目标目录已有数据库：不复制当前数据，直接改用该目录（重启生效）
  const handleAdoptDir = () =>
    withBusy("switch", async () => {
      if (!pendingAdoptDir) return;
      await db.setDataDirectory(pendingAdoptDir, false);
      setPendingAdoptDir(null);
      promptRestart("已切换到目标数据目录，应用即将重启以生效");
    });

  const handleReset = () =>
    withBusy("reset", async () => {
      if (!info || !info.isCustom) return;
      await db.resetDataDirectory();
      promptRestart("已恢复默认数据目录，应用即将重启以生效");
    });

  const handleBackup = () =>
    withBusy("backup", async () => {
      const path = await db.backupData();
      showToast(`已备份到：${path}`, "success");
      refresh();
    });

  const handleExport = () =>
    withBusy("export", async () => {
      const path = await save({
        title: "导出数据",
        defaultPath: "taglauncher_export.db",
        filters: [{ name: "TagLauncher DB", extensions: ["db"] }],
      });
      if (!path) return;
      await db.exportData(path);
      showToast("数据已导出", "success");
    });

  const handleImport = () =>
    withBusy("import", async () => {
      const selected = await dialogOpen({
        title: "选择要导入的数据库",
        multiple: false,
        filters: [{ name: "TagLauncher DB", extensions: ["db"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const backup = await db.importData(selected);
      showToast(`已导入（原数据已备份到 ${backup}），应用即将重启`, "success");
      window.setTimeout(() => {
        void db.restartApp().catch(() => showToast("请手动重启应用以生效", "warning"));
      }, 1500);
    });

  const openBackupsDir = () => {
    if (info?.backupsDir) void shellOpen(info.backupsDir).catch(() => showToast("打开目录失败", "error"));
  };

  return (
    <section className="surface-card-soft mt-6 p-5">
      <div className="text-label">Data</div>
      <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">数据管理</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">自定义数据目录，导出、导入与备份应用数据</p>

      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-[var(--text-muted)]">当前数据目录</span>
          <span className="flex items-center gap-2">
            {info?.isCustom && (
              <span className="rounded-none bg-[var(--accent-primary-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)]">
                自定义
              </span>
            )}
            <span className="text-xs text-[var(--text-faint)]">{info ? formatBytes(info.dbSizeBytes) : "…"}</span>
          </span>
        </div>
        <p className="mt-1 break-all text-sm text-[var(--text-primary)]" title={info?.saveDir}>
          {info?.saveDir ?? "读取中…"}
        </p>
      </div>

      {pendingAdoptDir && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_36%,transparent)] bg-[var(--status-warning-bg)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">目标目录已存在 TagLauncher 数据库</p>
          <p className="mt-1 break-all text-xs text-[var(--text-muted)]" title={pendingAdoptDir}>{pendingAdoptDir}</p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            不能迁移覆盖（会丢失该目录已有数据）。你可以直接改用该目录中的数据（当前数据保留在原目录，不受影响）。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleAdoptDir()}
              disabled={busy !== null}
              className="action-button action-button-primary px-4 text-xs disabled:opacity-50"
            >
              {busy === "switch" ? "切换中…" : "直接使用该目录数据"}
            </button>
            <button
              type="button"
              onClick={() => setPendingAdoptDir(null)}
              disabled={busy !== null}
              className="action-button px-4 text-xs disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void handleSwitchDir()} disabled={busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
          {busy === "switch" ? "切换中…" : "切换目录"}
        </button>
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={busy !== null || !info?.isCustom}
          className="action-button px-4 text-xs disabled:opacity-50"
        >
          恢复默认
        </button>
        <div className="mx-1 h-6 w-px self-center bg-[var(--border-subtle)]" />
        <button type="button" onClick={() => void handleBackup()} disabled={busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
          {busy === "backup" ? "备份中…" : "一键备份"}
        </button>
        <button type="button" onClick={() => void handleExport()} disabled={busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
          导出数据
        </button>
        <button type="button" onClick={() => void handleImport()} disabled={busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
          导入数据
        </button>
        <button type="button" onClick={openBackupsDir} disabled={busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
          打开备份目录
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--text-faint)]">
        切换目录会把当前数据复制到新位置；导入会覆盖当前数据（导入前自动备份）。两者完成后需重启应用生效。
      </p>
    </section>
  );
}

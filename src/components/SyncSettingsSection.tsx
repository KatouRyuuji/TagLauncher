import { useEffect, useState } from "react";
import * as db from "../lib/db";
import type { SyncConfig, RemoteBackup } from "../lib/db";
import { formatBytes } from "../lib/itemQuery";
import { showToast } from "../lib/toast";
import { SettingsField, inputClass } from "./SettingsField";

const EMPTY_CONFIG: SyncConfig = {
  url: "",
  username: "",
  password: "",
  remoteDir: "TagLauncher",
  autoSync: false,
};

function formatLastSync(ts: number | undefined): string {
  if (!ts) return "从未同步";
  const date = new Date(ts * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type BusyAction = "save" | "test" | "backup" | "list" | "restore" | null;

export function SyncSettingsSection() {
  const [config, setConfig] = useState<SyncConfig>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [backups, setBackups] = useState<RemoteBackup[] | null>(null);
  /** 待确认恢复的云端文件名（内联确认，恢复会覆盖本机数据） */
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);

  useEffect(() => {
    void db
      .syncGetConfig()
      .then((c) => setConfig({ ...EMPTY_CONFIG, ...c }))
      .catch((e) => showToast(`读取云同步配置失败：${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setLoaded(true));
  }, []);

  const update = <K extends keyof SyncConfig>(key: K, value: SyncConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
  };

  const hasStoredPassword = config.hasPassword === true;
  const configured = config.url.trim() !== "";
  const insecureHttp = config.url.trim().startsWith("http://");

  /** 保存配置；保存成功后清空本地明文密码输入并同步"已存"标记 */
  const saveConfig = async (): Promise<boolean> => {
    try {
      await db.syncSetConfig(config);
      setConfig((c) => ({
        ...c,
        password: "",
        hasPassword: c.hasPassword === true || c.password.trim() !== "",
      }));
      return true;
    } catch (e) {
      showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, "error");
      return false;
    }
  };

  const handleSave = async () => {
    setBusy("save");
    if (await saveConfig()) showToast("云同步配置已保存", "success");
    setBusy(null);
  };

  const handleTest = async () => {
    setBusy("test");
    // 先保存再测试，避免测的是旧配置
    if (!(await saveConfig())) {
      setBusy(null);
      return;
    }
    try {
      const message = await db.syncTestConnection();
      showToast(message, "success");
    } catch (e) {
      showToast(`连接失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const handleBackupNow = async () => {
    setBusy("backup");
    if (!(await saveConfig())) {
      setBusy(null);
      return;
    }
    try {
      const name = await db.syncBackupNow();
      showToast(`已备份到云端：${name}`, "success");
      const fresh = await db.syncGetConfig();
      setConfig((c) => ({ ...c, lastSyncTs: fresh.lastSyncTs }));
      // 若列表已展开则刷新
      if (backups !== null) setBackups(await db.syncListBackups());
    } catch (e) {
      showToast(`云端备份失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const handleToggleList = async () => {
    if (backups !== null) {
      setBackups(null);
      setPendingRestore(null);
      return;
    }
    setBusy("list");
    try {
      setBackups(await db.syncListBackups());
    } catch (e) {
      showToast(`获取云端备份列表失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (name: string) => {
    setBusy("restore");
    try {
      const safety = await db.syncRestore(name);
      showToast(`已从云端恢复（原数据已备份到 ${safety}），应用即将重启`, "success");
      window.setTimeout(() => {
        void db.restartApp().catch(() => showToast("请手动重启应用以生效", "warning"));
      }, 1500);
    } catch (e) {
      showToast(`恢复失败：${e instanceof Error ? e.message : String(e)}`, "error");
      setBusy(null);
    }
  };

  const handleClearPassword = async () => {
    setBusy("save");
    try {
      await db.syncClearPassword();
      setConfig((c) => ({ ...c, password: "", hasPassword: false }));
      showToast("已清除保存的 WebDAV 密码", "success");
    } catch (e) {
      showToast(`清除失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="surface-card-soft mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-label">Cloud Sync</div>
          <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">云同步（WebDAV）</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            备份到 NAS、Nextcloud、坚果云等任意 WebDAV 服务，数据仍全部由你掌控
          </p>
        </div>
        <span
          className="mt-1 shrink-0 rounded-none px-2.5 py-1 text-xs font-medium"
          style={{
            background: configured ? "var(--status-success-bg)" : "var(--bg-hover)",
            color: configured ? "var(--color-success)" : "var(--text-muted)",
          }}
        >
          {configured ? "已配置" : "未配置"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <SettingsField label="WebDAV 服务器地址">
          <input
            type="text"
            value={config.url}
            onChange={(e) => update("url", e.target.value)}
            placeholder="https://dav.example.com/dav 或 http://192.168.1.10:5005"
            spellCheck={false}
            className={inputClass}
          />
        </SettingsField>
        {insecureHttp && (
          <p className="text-xs text-[var(--color-warning)]">
            当前为 http 明文连接：凭据与数据不加密传输，仅建议在可信局域网（如家庭 NAS）使用。
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <SettingsField label="用户名">
            <input
              type="text"
              value={config.username}
              onChange={(e) => update("username", e.target.value)}
              placeholder="WebDAV 账号"
              spellCheck={false}
              autoComplete="off"
              className={inputClass}
            />
          </SettingsField>
          <SettingsField label="密码">
            <div className="flex gap-2">
              <input
                type={showPassword ? "text" : "password"}
                value={config.password}
                onChange={(e) => update("password", e.target.value)}
                placeholder={hasStoredPassword ? "已保存（留空表示不修改）" : "应用密码 / 授权码"}
                spellCheck={false}
                autoComplete="off"
                className={inputClass}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="action-button min-h-[44px] shrink-0 px-3 text-xs">
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </SettingsField>
        </div>

        <SettingsField label="远端目录">
          <input
            type="text"
            value={config.remoteDir}
            onChange={(e) => update("remoteDir", e.target.value)}
            placeholder="TagLauncher"
            spellCheck={false}
            className={inputClass}
          />
        </SettingsField>

        <button
          type="button"
          onClick={() => update("autoSync", !config.autoSync)}
          aria-pressed={config.autoSync}
          className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-4 py-3 text-left"
        >
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]">自动云备份</span>
            <span className="block text-xs text-[var(--text-muted)]">
              启动时后台自动备份到云端（距上次备份超过 24 小时才触发）· 上次备份：{formatLastSync(config.lastSyncTs)}
            </span>
          </span>
          <span
            className="relative h-6 w-11 shrink-0 rounded-none transition-colors"
            style={{ background: config.autoSync ? "var(--accent-primary)" : "var(--border-medium)" }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-none bg-white transition-[left]"
              style={{ left: config.autoSync ? "22px" : "2px" }}
            />
          </span>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSave()} disabled={!loaded || busy !== null} className="action-button action-button-primary px-4 text-xs disabled:opacity-50">
          {busy === "save" ? "保存中…" : "保存配置"}
        </button>
        <button type="button" onClick={() => void handleTest()} disabled={!loaded || busy !== null || !configured} className="action-button px-4 text-xs disabled:opacity-50">
          {busy === "test" ? "测试中…" : "测试连接"}
        </button>
        {hasStoredPassword && (
          <button type="button" onClick={() => void handleClearPassword()} disabled={!loaded || busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
            清除密码
          </button>
        )}
        <div className="mx-1 h-6 w-px bg-[var(--border-subtle)]" />
        <button type="button" onClick={() => void handleBackupNow()} disabled={!loaded || busy !== null || !configured} className="action-button px-4 text-xs disabled:opacity-50">
          {busy === "backup" ? "备份中…" : "立即备份到云端"}
        </button>
        <button type="button" onClick={() => void handleToggleList()} disabled={!loaded || busy !== null || !configured} className="action-button px-4 text-xs disabled:opacity-50">
          {busy === "list" ? "获取中…" : backups !== null ? "收起云端备份" : "查看云端备份"}
        </button>
      </div>

      {backups !== null && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
          {backups.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--text-muted)]">云端暂无备份</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {backups.map((backup) => (
                <li key={backup.name} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--text-primary)]" title={backup.name}>{backup.name}</p>
                      <p className="text-xs text-[var(--text-faint)]">
                        {formatBytes(backup.sizeBytes)}{backup.modified ? ` · ${backup.modified}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingRestore(backup.name)}
                      disabled={busy !== null}
                      className="action-button shrink-0 px-3 text-xs disabled:opacity-50"
                    >
                      恢复
                    </button>
                  </div>
                  {pendingRestore === backup.name && (
                    <div className="mt-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning)_36%,transparent)] bg-[var(--status-warning-bg)] px-3 py-2.5">
                      <p className="text-xs text-[var(--text-primary)]">
                        恢复会用该云端备份<span className="font-semibold">覆盖本机全部数据</span>（当前数据自动备份到本地，可回退），完成后应用将重启。继续？
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRestore(backup.name)}
                          disabled={busy !== null}
                          className="action-button action-button-primary px-3 text-xs disabled:opacity-50"
                        >
                          {busy === "restore" ? "恢复中…" : "确认恢复"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRestore(null)}
                          disabled={busy !== null}
                          className="action-button px-3 text-xs disabled:opacity-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-[var(--text-faint)]">
        云端副本自动剔除 AI 密钥与同步凭据等敏感配置；远端保留最近 10 份备份，更早的自动清理。
      </p>
    </section>
  );
}

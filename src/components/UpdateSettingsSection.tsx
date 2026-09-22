import { useEffect, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { ExternalLink } from "lucide-react";
import * as db from "../lib/db";
import type { UpdateInfo } from "../lib/db";
import { formatBytes } from "../lib/itemQuery";
import { showToast } from "../lib/toast";

const LAST_CHECK_KEY = "taglauncher.update_last_check";
const RELEASES_PAGE_URL = "https://github.com/KatouRyuuji/TagLauncher/releases";

interface LastCheckRecord {
  ts: number;
  latestVersion: string;
}

function loadLastCheck(): LastCheckRecord | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastCheckRecord>;
    if (typeof parsed.ts !== "number" || typeof parsed.latestVersion !== "string") return null;
    return { ts: parsed.ts, latestVersion: parsed.latestVersion };
  } catch {
    return null;
  }
}

function formatCheckTime(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function UpdateSettingsSection() {
  const [currentVersion, setCurrentVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateInfo | null>(null);
  const [lastCheck, setLastCheck] = useState<LastCheckRecord | null>(loadLastCheck);

  useEffect(() => {
    void db.getAppVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const info = await db.updateCheck();
      setResult(info);
      const record: LastCheckRecord = { ts: Date.now(), latestVersion: info.latestVersion };
      setLastCheck(record);
      try {
        localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(record));
      } catch {
        // 隐私模式或配额不足时忽略
      }
      if (!info.hasUpdate) showToast("当前已是最新版本", "success");
    } catch (e) {
      showToast(`检查更新失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const url = result.installerUrl || result.releaseUrl;
    if (!url) return;
    void shellOpen(url).catch(() => showToast("打开下载链接失败", "error"));
  };

  return (
    // 单卡片页面窄栏居中：整页只有一个信息块时不摊满设置工作台宽度
    <section className="surface-card-soft mx-auto mt-6 max-w-[680px] p-5">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">软件更新</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        更新来自 GitHub Releases。检查对照远端版本，有新版本再手动下载安装，不会自动安装。
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="instrument-label">当前版本</p>
          <p className="data-readout mt-1.5 text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            {currentVersion ? `v${currentVersion}` : "…"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            {lastCheck
              ? `上次检查 ${formatCheckTime(lastCheck.ts)} · 最新发布 v${lastCheck.latestVersion}`
              : "尚未检查过更新"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={checking}
            className="action-button action-button-primary px-4 text-xs disabled:opacity-50"
          >
            {checking ? "检查中…" : "检查更新"}
          </button>
          <button
            type="button"
            onClick={() => void shellOpen(RELEASES_PAGE_URL).catch(() => showToast("打开更新日志失败", "error"))}
            className="action-button px-3 py-1.5 text-xs"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            查看更新日志
          </button>
        </div>
      </div>

      {result?.hasUpdate && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[var(--accent-primary-bg-light)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              发现新版本 v{result.latestVersion}
              {result.installerSize > 0 && (
                <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                  安装包 {formatBytes(result.installerSize)}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={handleDownload}
              className="action-button action-button-primary shrink-0 px-4 text-xs"
            >
              下载更新
            </button>
          </div>
          {result.releaseNotes.trim() && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-muted)]" style={{ fontFamily: "inherit" }}>
              {result.releaseNotes.trim()}
            </pre>
          )}
          <p className="mt-2 text-xs text-[var(--text-faint)]">
            下载完成后运行安装包即可覆盖升级，数据不受影响。
          </p>
        </div>
      )}

      {result && !result.hasUpdate && (
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          本次检查：已是最新版本（最新发布 v{result.latestVersion}）。
        </p>
      )}
    </section>
  );
}

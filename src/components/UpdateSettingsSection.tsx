import { useEffect, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import * as db from "../lib/db";
import type { UpdateInfo } from "../lib/db";
import { formatBytes } from "../lib/itemQuery";
import { showToast } from "../lib/toast";

export function UpdateSettingsSection() {
  const [currentVersion, setCurrentVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void db.getAppVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const info = await db.updateCheck();
      setResult(info);
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
    <section className="surface-card-soft mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-label">Update</div>
          <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">软件更新</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            当前版本 v{currentVersion || "…"} · 更新通过 GitHub Releases 分发
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={checking}
          className="action-button mt-1 shrink-0 px-4 text-xs disabled:opacity-50"
        >
          {checking ? "检查中…" : "检查更新"}
        </button>
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
        <p className="mt-3 text-sm text-[var(--text-muted)]">已是最新版本（最新发布 v{result.latestVersion}）。</p>
      )}
    </section>
  );
}

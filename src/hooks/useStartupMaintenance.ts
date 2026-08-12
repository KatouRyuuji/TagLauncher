import { useEffect } from "react";
import * as db from "../lib/db";
import { showToast } from "../lib/toast";

/** 上次自动检查更新的时间（ms epoch），24h 内不重复请求 GitHub API */
const UPDATE_LAST_CHECK_KEY = "taglauncher.update_last_check_ts";
/** 已提示过的新版本号：同一版本只弹一次 toast（设置页仍可手动检查） */
const UPDATE_NOTIFIED_KEY = "taglauncher.update_notified_version";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 启动后延迟执行，避开首屏数据加载高峰 */
const UPDATE_CHECK_DELAY_MS = 8_000;
const CLOUD_SYNC_DELAY_MS = 15_000;

/**
 * 启动期后台维护：
 * 1. 在线更新检查（GitHub Releases，24h 节流，同版本只提示一次）；
 * 2. 自动云备份（WebDAV，需在设置中开启，距上次备份超过 24h 才触发）。
 * 全部静默容错：网络不可达/未配置时不打扰用户（自动云备份失败例外，
 * 提示一次让用户知道备份没有发生）。
 */
export function useStartupMaintenance() {
  useEffect(() => {
    const updateTimer = window.setTimeout(() => {
      void checkUpdateSilently();
    }, UPDATE_CHECK_DELAY_MS);
    const syncTimer = window.setTimeout(() => {
      void autoCloudBackup();
    }, CLOUD_SYNC_DELAY_MS);
    return () => {
      window.clearTimeout(updateTimer);
      window.clearTimeout(syncTimer);
    };
  }, []);
}

async function checkUpdateSilently(): Promise<void> {
  try {
    const last = Number(localStorage.getItem(UPDATE_LAST_CHECK_KEY) ?? "0");
    if (Date.now() - last < DAY_MS) return;
  } catch {
    // localStorage 不可用时照常检查
  }

  try {
    const info = await db.updateCheck();
    try {
      localStorage.setItem(UPDATE_LAST_CHECK_KEY, String(Date.now()));
    } catch {
      // ignore storage failures
    }
    if (!info.hasUpdate) return;

    let alreadyNotified = false;
    try {
      alreadyNotified = localStorage.getItem(UPDATE_NOTIFIED_KEY) === info.latestVersion;
      localStorage.setItem(UPDATE_NOTIFIED_KEY, info.latestVersion);
    } catch {
      // ignore storage failures
    }
    if (!alreadyNotified) {
      showToast(`发现新版本 v${info.latestVersion}，可在 设置 → 软件更新 中下载`, "info");
    }
  } catch {
    // 静默：启动期检查失败不打扰（离线/限流均正常）
  }
}

async function autoCloudBackup(): Promise<void> {
  let config: Awaited<ReturnType<typeof db.syncGetConfig>>;
  try {
    config = await db.syncGetConfig();
  } catch {
    return;
  }
  if (!config.autoSync || config.url.trim() === "") return;
  const lastTs = (config.lastSyncTs ?? 0) * 1000;
  if (Date.now() - lastTs < DAY_MS) return;

  try {
    await db.syncBackupNow();
    showToast("已自动备份到云端", "success");
  } catch (e) {
    // 自动备份失败要让用户知道（否则以为有备份实际没有）；每次启动至多一条
    showToast(`自动云备份失败：${e instanceof Error ? e.message : String(e)}`, "warning");
  }
}

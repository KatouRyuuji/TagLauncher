import { useState, useEffect, useCallback } from "react";
import type { ModInfo } from "../types/mod";
import * as db from "../lib/db";
import { enableModRuntime, disableModRuntime, reloadModRuntime } from "../lib/modRuntime";

function showToast(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", { detail: { message, type } }),
  );
}

export function useMods() {
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMods = useCallback(async () => {
    try {
      const modList = await db.getMods();
      setMods(modList);
    } catch {
      setMods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 启动时加载 mod 列表 + 检查加载错误
  useEffect(() => {
    void loadMods();

    // 异步获取启动时收集的加载错误（manifest 解析失败 / enabled_mods 损坏等）
    void db.getModLoadErrors().then((errors) => {
      for (const err of errors) {
        showToast(`Mod 加载失败 [${err.dir_name}]：${err.error}`, "error");
      }
    }).catch(() => {/* 静默忽略 */});
  }, [loadMods]);

  const enableMod = useCallback(
    async (modId: string) => {
      await db.enableMod(modId);
      const modList = await db.getMods();
      setMods(modList);
      const mod = modList.find((m) => m.id === modId);
      if (mod) {
        if (!mod.is_compatible) {
          showToast(
            `Mod "${mod.name}" 不兼容当前版本：${mod.incompatible_reason ?? "版本不满足"}`,
            "warning",
          );
        }
        await enableModRuntime(mod);
      }
    },
    [],
  );

  const disableMod = useCallback(
    async (modId: string) => {
      await db.disableMod(modId);
      const mod = mods.find((m) => m.id === modId);
      if (mod) await disableModRuntime(mod);
      await loadMods();
    },
    [mods, loadMods],
  );

  const reloadMod = useCallback(
    async (modId: string) => {
      const mod = mods.find((m) => m.id === modId);
      if (!mod) return;
      await reloadModRuntime(mod);
    },
    [mods],
  );

  return { mods, loading, enableMod, disableMod, reloadMod, refresh: loadMods };
}

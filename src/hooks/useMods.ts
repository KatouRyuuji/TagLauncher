import { useState, useEffect, useCallback } from "react";
import type { ModInfo } from "../types/mod";
import * as db from "../lib/db";
import {
  enableModRuntime,
  disableModRuntime,
  reloadModRuntime,
  checkDependencySatisfied,
} from "../lib/modRuntime";
import { callModLifecycle, clearModLifecycle } from "../lib/modApi";

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
      const modList = await db.getMods();
      const mod = modList.find((m) => m.id === modId);
      if (!mod) return;

      // 依赖检查
      const check = checkDependencySatisfied(mod, modList);
      if (!check.satisfied) {
        const reasons: string[] = [];
        if (check.missing.length) reasons.push(`缺少依赖：${check.missing.join(", ")}`);
        for (const u of check.unsatisfied) {
          reasons.push(`依赖 "${u.id}" 版本不满足（需要 ${u.required}，实际 ${u.actual}）`);
        }
        showToast(`Mod "${mod.name}" 依赖未满足：${reasons.join("；")}`, "error");
        return;
      }

      await db.enableMod(modId);
      const updatedList = await db.getMods();
      setMods(updatedList);
      const updatedMod = updatedList.find((m) => m.id === modId);
      if (updatedMod) {
        if (!updatedMod.is_compatible) {
          showToast(
            `Mod "${updatedMod.name}" 不兼容当前版本：${updatedMod.incompatible_reason ?? "版本不满足"}`,
            "warning",
          );
        }
        await enableModRuntime(updatedMod);
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

  const uninstallMod = useCallback(
    async (modId: string) => {
      const mod = mods.find((m) => m.id === modId);
      if (!mod) return;

      // 1. 如果已启用，先禁用（保留生命周期注册表，以便执行 uninstall 回调）
      if (mod.enabled) {
        await db.disableMod(modId);
        await disableModRuntime(mod, true);
      }

      // 2. 执行 uninstall 生命周期回调
      await callModLifecycle(modId, "uninstall");

      // 3. 清理生命周期注册表
      clearModLifecycle(modId);

      // 4. 清理该 mod 的 storage 数据
      const prefix = `__mod::${modId}::`;
      Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .forEach((k) => localStorage.removeItem(k));

      // 5. 后端删除目录和注册表记录
      await db.deleteMod(modId);

      // 6. 刷新列表
      showToast(`Mod "${mod.name}" 已卸载`, "success");
      await loadMods();
    },
    [mods, loadMods],
  );

  return { mods, loading, enableMod, disableMod, reloadMod, uninstallMod, refresh: loadMods };
}

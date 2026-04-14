import { useState, useEffect, useCallback } from "react";
import type { ModInfo } from "../types/mod";
import * as db from "../lib/db";
import { enableModRuntime, disableModRuntime } from "../lib/modRuntime";

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

  useEffect(() => {
    void loadMods();
  }, [loadMods]);

  const enableMod = useCallback(
    async (modId: string) => {
      await db.enableMod(modId);
      // 刷新列表后找到该 mod，注入运行时
      const modList = await db.getMods();
      setMods(modList);
      const mod = modList.find((m) => m.id === modId);
      if (mod) await enableModRuntime(mod);
    },
    [],
  );

  const disableMod = useCallback(
    async (modId: string) => {
      await db.disableMod(modId);
      // 先找到 mod 信息再刷新列表，这样 disableModRuntime 还能拿到 entrypoints
      const mod = mods.find((m) => m.id === modId);
      if (mod) disableModRuntime(mod);
      await loadMods();
    },
    [mods, loadMods],
  );

  return { mods, loading, enableMod, disableMod, refresh: loadMods };
}

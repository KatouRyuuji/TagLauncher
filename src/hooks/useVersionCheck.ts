import { useState, useEffect } from "react";
import * as db from "../lib/db";

interface MigrationStatus {
  show: boolean;
  appliedMigrations: string[];
  fromVersion: string;
  toVersion: string;
}

export function useVersionCheck() {
  const [migration, setMigration] = useState<MigrationStatus>({
    show: false,
    appliedMigrations: [],
    fromVersion: "",
    toVersion: "",
  });

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const currentVersion = await db.getAppVersion();
        const storedVersion = await db.getSetting("last_known_version");

        if (storedVersion && storedVersion !== currentVersion) {
          // 版本已更新
          setMigration({
            show: true,
            appliedMigrations: ["数据结构兼容性检查"],
            fromVersion: storedVersion,
            toVersion: currentVersion,
          });
        }

        // 更新存储的版本号
        await db.setSetting("last_known_version", currentVersion);
      } catch {
        // 静默失败（首次启动时 app_meta 可能还没有数据）
      }
    };
    void checkVersion();
  }, []);

  const dismissMigration = () => {
    setMigration((prev) => ({ ...prev, show: false }));
  };

  return { migration, dismissMigration };
}

import { useState, useEffect } from "react";
import { checkVersionMigration } from "../lib/db";

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
    // 卸载保护：组件销毁后不再 setState
    let cancelled = false;
    const checkVersion = async () => {
      try {
        // 后端单命令原子完成"读旧版本 → 比较 → 写新版本"，
        // 替代原先 读-比-写 三步 IPC（并发/中途失败会留下错误的版本记录）。
        const result = await checkVersionMigration();
        if (cancelled || !result) return;
        setMigration({
          show: true,
          appliedMigrations: ["检测到版本更新"],
          fromVersion: result.fromVersion,
          toVersion: result.toVersion,
        });
      } catch {
        // 静默失败（首次启动时 app_meta 可能还没有数据）
      }
    };
    void checkVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissMigration = () => {
    setMigration((prev) => ({ ...prev, show: false }));
  };

  return { migration, dismissMigration };
}

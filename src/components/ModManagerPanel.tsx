import { useState } from "react";
import { useMods } from "../hooks/useMods";
import { enableModRuntime, reloadModRuntime } from "../lib/modRuntime";
import type { ModPermission } from "../types/mod";

const PERMISSION_META: Record<ModPermission, { label: string; color: string }> = {
  "items:read": { label: "读取项目", color: "var(--accent-primary)" },
  "items:write": { label: "修改项目", color: "var(--color-warning)" },
  "tags:read": { label: "读取标签", color: "var(--accent-primary)" },
  "tags:write": { label: "修改标签", color: "var(--color-warning)" },
  "cabinets:read": { label: "读取文件柜", color: "var(--accent-primary)" },
  "cabinets:write": { label: "修改文件柜", color: "var(--color-warning)" },
  launch: { label: "启动项目", color: "var(--color-warning)" },
  storage: { label: "本地存储", color: "var(--color-success)" },
  dom: { label: "DOM 访问", color: "var(--color-danger)" },
  theme: { label: "主题读写", color: "var(--color-success)" },
};

export function ModManagerPanel() {
  const { mods, enableMod, disableMod } = useMods();
  const [confirmJsMod, setConfirmJsMod] = useState<string | null>(null);
  const [reloading, setReloading] = useState<string | null>(null);

  const handleToggle = async (modId: string, modType: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      await disableMod(modId);
      return;
    }
    if (modType === "css+js") {
      setConfirmJsMod(modId);
      return;
    }
    await enableMod(modId);
  };

  const handleConfirmEnable = async () => {
    if (confirmJsMod) {
      await enableMod(confirmJsMod);
      setConfirmJsMod(null);
    }
  };

  const handleReload = async (modId: string) => {
    setReloading(modId);
    try {
      const mod = mods.find((item) => item.id === modId);
      if (!mod) return;
      if (mod.type === "css+js") {
        await reloadModRuntime(mod);
      } else {
        await enableModRuntime(mod);
      }
    } finally {
      setReloading(null);
    }
  };

  if (mods.length === 0) {
    return (
      <div className="surface-card-soft p-5 text-center">
        <p className="text-sm text-[var(--text-muted)]">暂无已安装的扩展</p>
        <p className="mt-2 text-xs leading-6 text-[var(--text-faint)]">
          将 mod 文件夹放入应用数据目录中的 <code className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">mods/</code> 即可加载。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mods.map((mod) => {
        const permissions = (mod.permissions ?? []) as ModPermission[];
        const canReload = mod.type === "css" || mod.type === "css+js";

        return (
          <div
            key={mod.id}
            className="surface-card-soft p-4"
            style={{
              borderColor: mod.enabled
                ? "color-mix(in srgb, var(--accent-primary) 30%, transparent)"
                : "var(--border-subtle)",
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-[var(--text-primary)]">{mod.name}</span>
                  <TypeBadge type={mod.type} />
                  {mod.enabled && (
                    <span className="rounded-[var(--radius-full)] bg-[var(--status-success-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--color-success)]">
                      已启用
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  v{mod.version} · {mod.author}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{mod.description}</p>
              </div>

              <div className="flex items-center gap-2">
                {canReload && mod.enabled && (
                  <button
                    type="button"
                    onClick={() => void handleReload(mod.id)}
                    disabled={reloading === mod.id}
                    className="action-button min-h-[36px] px-3 text-xs"
                  >
                    {reloading === mod.id ? "重载中..." : "热重载"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleToggle(mod.id, mod.type, mod.enabled)}
                  className={mod.enabled ? "action-button min-h-[36px] px-3 text-xs" : "action-button action-button-primary min-h-[36px] px-3 text-xs"}
                  style={mod.enabled ? {
                    color: "var(--color-danger)",
                    borderColor: "color-mix(in srgb, var(--color-danger) 24%, transparent)",
                    backgroundColor: "var(--color-danger-bg)",
                  } : undefined}
                >
                  {mod.enabled ? "禁用" : "启用"}
                </button>
              </div>
            </div>

            {permissions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {permissions.map((permission) => {
                  const meta = PERMISSION_META[permission] ?? { label: permission, color: "var(--text-muted)" };
                  return (
                    <span
                      key={permission}
                      className="rounded-[var(--radius-full)] border px-2.5 py-1 text-[11px] font-medium"
                      style={{
                        color: meta.color,
                        borderColor: `color-mix(in srgb, ${meta.color} 26%, transparent)`,
                        backgroundColor: `color-mix(in srgb, ${meta.color} 10%, white)`,
                      }}
                    >
                      {meta.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {confirmJsMod && (() => {
        const mod = mods.find((item) => item.id === confirmJsMod);
        const permissions = (mod?.permissions ?? []) as ModPermission[];
        const hasDangerPermission = permissions.includes("dom");

        return (
          <>
            <div
              className="fixed inset-0"
              style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-mod-confirm-overlay)" as unknown as number }}
              onClick={() => setConfirmJsMod(null)}
            />
            <div
              className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
              style={{ zIndex: "var(--z-mod-confirm-panel)" as unknown as number }}
            >
              <div className="modal-surface pointer-events-auto w-[420px] max-w-[92vw] p-6">
                <div className="text-label">Security</div>
                <h3 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">启用脚本扩展</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
                  此扩展包含 JavaScript 代码，会在应用中执行。请确认其来源可信，再继续启用。
                </p>

                {permissions.length > 0 && (
                  <div className="surface-card-soft mt-5 p-4">
                    <div className="text-label">Permissions</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {permissions.map((permission) => {
                        const meta = PERMISSION_META[permission] ?? { label: permission, color: "var(--text-muted)" };
                        return (
                          <span
                            key={permission}
                            className="rounded-[var(--radius-full)] border px-2.5 py-1 text-[11px] font-medium"
                            style={{
                              color: meta.color,
                              borderColor: `color-mix(in srgb, ${meta.color} 26%, transparent)`,
                              backgroundColor: `color-mix(in srgb, ${meta.color} 10%, white)`,
                            }}
                          >
                            {meta.label}
                          </span>
                        );
                      })}
                    </div>
                    {hasDangerPermission && (
                      <p className="mt-3 text-xs text-[var(--color-danger)]">
                        此扩展申请了 DOM 访问权限，具备较高的界面操作能力。
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmJsMod(null)} className="action-button">
                    取消
                  </button>
                  <button type="button" onClick={() => void handleConfirmEnable()} className="action-button action-button-primary">
                    我信任此扩展
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, { label: string; color: string; bg: string }> = {
    css: { label: "CSS", color: "var(--accent-primary)", bg: "var(--accent-primary-bg)" },
    "css+js": { label: "CSS + JS", color: "var(--color-warning)", bg: "var(--status-warning-bg)" },
    theme: { label: "主题", color: "var(--color-success)", bg: "var(--status-success-bg)" },
  };
  const style = styles[type] ?? { label: type, color: "var(--text-muted)", bg: "var(--bg-hover)" };

  return (
    <span
      className="rounded-[var(--radius-full)] px-2.5 py-1 text-[11px] font-medium"
      style={{ color: style.color, backgroundColor: style.bg }}
    >
      {style.label}
    </span>
  );
}

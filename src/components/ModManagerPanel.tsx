import { useState } from "react";
import { useMods } from "../hooks/useMods";
import { enableModRuntime } from "../lib/modRuntime";
import type { ModPermission } from "../types/mod";

// 权限标签的友好名称与颜色
const PERMISSION_META: Record<ModPermission, { label: string; color: string }> = {
  "items:read":    { label: "读取项目",   color: "var(--accent-primary)" },
  "items:write":   { label: "修改项目",   color: "var(--color-warning)" },
  "tags:read":     { label: "读取标签",   color: "var(--accent-primary)" },
  "tags:write":    { label: "修改标签",   color: "var(--color-warning)" },
  "cabinets:read": { label: "读取文件柜", color: "var(--accent-primary)" },
  "cabinets:write":{ label: "修改文件柜", color: "var(--color-warning)" },
  "launch":        { label: "启动项目",   color: "var(--color-warning)" },
  "storage":       { label: "本地存储",   color: "var(--color-success)" },
  "dom":           { label: "DOM 访问",   color: "var(--color-danger)" },
  "theme":         { label: "主题读写",   color: "var(--color-success)" },
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

  // 重载 CSS mod（不重启，仅重新注入 CSS）
  const handleReloadCss = async (modId: string) => {
    setReloading(modId);
    try {
      const mod = mods.find((m) => m.id === modId);
      if (mod) await enableModRuntime(mod);
    } finally {
      setReloading(null);
    }
  };

  if (mods.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed p-4 text-center"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          暂无已安装的扩展
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>
          将 mod 文件夹放入应用数据目录的{" "}
          <code
            className="px-1 rounded"
            style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-muted)" }}
          >
            mods/
          </code>{" "}
          文件夹即可加载
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {mods.map((mod) => {
        const perms = (mod.permissions ?? []) as ModPermission[];
        const isCss = mod.type === "css";

        return (
          <div
            key={mod.id}
            className="rounded-[var(--radius-md)] border p-3"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: mod.enabled ? "var(--accent-primary)" : "var(--border-subtle)",
            }}
          >
            {/* 头部：名称 + 类型徽章 + 操作按钮 */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {mod.name}
                  </span>
                  <TypeBadge type={mod.type} />
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  v{mod.version} · {mod.author}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* CSS mod 重载按钮 */}
                {isCss && mod.enabled && (
                  <button
                    onClick={() => void handleReloadCss(mod.id)}
                    disabled={reloading === mod.id}
                    className="px-2 py-1 rounded-[var(--radius-sm)] text-xs transition-colors"
                    style={{
                      backgroundColor: "var(--bg-hover)",
                      color: reloading === mod.id ? "var(--text-faint)" : "var(--text-muted)",
                    }}
                    title="重载 CSS（不重启）"
                  >
                    {reloading === mod.id ? "…" : "↺"}
                  </button>
                )}
                {/* 启用/禁用按钮 */}
                <button
                  onClick={() => void handleToggle(mod.id, mod.type, mod.enabled)}
                  className="px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: mod.enabled ? "var(--color-danger-bg)" : "var(--accent-primary-bg)",
                    color: mod.enabled ? "var(--color-danger)" : "var(--accent-primary)",
                  }}
                >
                  {mod.enabled ? "禁用" : "启用"}
                </button>
              </div>
            </div>

            {/* 描述 */}
            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              {mod.description}
            </p>

            {/* 权限标签 */}
            {perms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {perms.map((perm) => {
                  const meta = PERMISSION_META[perm] ?? { label: perm, color: "var(--text-muted)" };
                  return (
                    <span
                      key={perm}
                      className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] border"
                      style={{
                        color: meta.color,
                        borderColor: meta.color,
                        backgroundColor: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
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

      {/* JS Mod 安全确认弹窗 */}
      {confirmJsMod && (() => {
        const mod = mods.find((m) => m.id === confirmJsMod);
        const perms = (mod?.permissions ?? []) as ModPermission[];
        const hasDangerPerm = perms.includes("dom");
        return (
          <>
            <div className="fixed inset-0 z-[250]" style={{ backgroundColor: "var(--overlay-bg)" }} onClick={() => setConfirmJsMod(null)} />
            <div className="fixed inset-0 z-[251] flex items-center justify-center pointer-events-none">
              <div
                className="pointer-events-auto w-[380px] rounded-[var(--radius-xl)] border p-5"
                style={{
                  backgroundColor: "var(--bg-overlay)",
                  borderColor: "var(--border-default)",
                  boxShadow: "var(--shadow-overlay)",
                }}
              >
                <h3 className="text-sm font-medium mb-1" style={{ color: "var(--color-warning)" }}>
                  ⚠ 安全提示
                </h3>
                <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                  此扩展包含 JavaScript 代码，将在应用中执行。请仅启用来自可信来源的扩展。
                </p>

                {/* 权限列表 */}
                {perms.length > 0 && (
                  <div className="mb-4 rounded-[var(--radius-md)] p-3" style={{ backgroundColor: "var(--bg-hover)" }}>
                    <p className="text-[10px] font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                      此扩展申请以下权限：
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {perms.map((perm) => {
                        const meta = PERMISSION_META[perm] ?? { label: perm, color: "var(--text-muted)" };
                        return (
                          <span
                            key={perm}
                            className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] border"
                            style={{ color: meta.color, borderColor: meta.color }}
                          >
                            {meta.label}
                          </span>
                        );
                      })}
                    </div>
                    {hasDangerPerm && (
                      <p className="text-[10px] mt-2" style={{ color: "var(--color-danger)" }}>
                        ⚠ 此扩展申请了 DOM 访问权限，具有较高风险
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setConfirmJsMod(null)}
                    className="px-3 py-1.5 rounded-[var(--radius-sm)] text-xs transition-colors"
                    style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-secondary)" }}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void handleConfirmEnable()}
                    className="px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors"
                    style={{ backgroundColor: "var(--color-warning)", color: "var(--text-invert)" }}
                  >
                    我信任此扩展，启用
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

// ── 类型徽章子组件 ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, { label: string; color: string; bg: string }> = {
    css:      { label: "CSS",      color: "var(--accent-primary)",  bg: "var(--accent-primary-bg)" },
    "css+js": { label: "CSS + JS", color: "var(--color-warning)",   bg: "rgba(234,179,8,0.1)" },
    theme:    { label: "主题",      color: "var(--color-success)",   bg: "rgba(34,197,94,0.1)" },
  };
  const s = styles[type] ?? { label: type, color: "var(--text-muted)", bg: "var(--bg-hover)" };
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}

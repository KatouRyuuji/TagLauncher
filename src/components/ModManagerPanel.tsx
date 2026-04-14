import { useState } from "react";
import { useMods } from "../hooks/useMods";

export function ModManagerPanel() {
  const { mods, enableMod, disableMod } = useMods();
  const [confirmJsMod, setConfirmJsMod] = useState<string | null>(null);

  const handleToggle = async (modId: string, modType: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      await disableMod(modId);
      return;
    }
    // JS mod 需要确认
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

  if (mods.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        暂无已安装的扩展。将 mod 放入应用数据目录的 mods/ 文件夹即可加载。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {mods.map((mod) => (
        <div
          key={mod.id}
          className="flex items-center justify-between p-3 rounded-[var(--radius-md)] border"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: mod.enabled ? "var(--accent-primary)" : "var(--border-subtle)",
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {mod.name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)]" style={{
                backgroundColor: "var(--bg-hover)",
                color: "var(--text-muted)",
              }}>
                {mod.type}
              </span>
            </div>
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
              {mod.description} — v{mod.version} by {mod.author}
            </p>
          </div>
          <button
            onClick={() => void handleToggle(mod.id, mod.type, mod.enabled)}
            className="ml-3 px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors shrink-0"
            style={{
              backgroundColor: mod.enabled ? "var(--color-danger-bg)" : "var(--accent-primary-bg)",
              color: mod.enabled ? "var(--color-danger-hover)" : "var(--accent-primary)",
            }}
          >
            {mod.enabled ? "禁用" : "启用"}
          </button>
        </div>
      ))}

      {/* JS Mod 安全确认弹窗 */}
      {confirmJsMod && (
        <>
          <div className="fixed inset-0 z-[250] bg-black/50" onClick={() => setConfirmJsMod(null)} />
          <div className="fixed inset-0 z-[251] flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto w-[360px] rounded-[var(--radius-xl)] border p-5"
              style={{
                backgroundColor: "var(--bg-overlay)",
                borderColor: "var(--border-default)",
                boxShadow: "var(--shadow-overlay)",
              }}
            >
              <h3 className="text-sm font-medium mb-2" style={{ color: "var(--color-warning)" }}>
                ⚠ 安全提示
              </h3>
              <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
                此扩展包含 JavaScript 代码，将在应用中执行。请仅启用来自可信来源的扩展。
              </p>
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
                  style={{ backgroundColor: "var(--color-warning)", color: "#000" }}
                >
                  我信任此扩展，启用
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

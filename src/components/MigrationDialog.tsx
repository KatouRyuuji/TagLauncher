interface MigrationDialogProps {
  open: boolean;
  appliedMigrations: string[];
  fromVersion: string;
  toVersion: string;
  onClose: () => void;
}

export function MigrationDialog({ open, appliedMigrations, fromVersion, toVersion, onClose }: MigrationDialogProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0" style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-migration-overlay)" as unknown as number }} onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: "var(--z-migration-panel)" as unknown as number }}>
        <div
          className="pointer-events-auto w-[420px] max-w-[90vw] rounded-[var(--radius-xl)] border p-6"
          style={{
            backgroundColor: "var(--bg-overlay)",
            borderColor: "var(--border-default)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-[var(--radius-full)] flex items-center justify-center text-xl" style={{ backgroundColor: "var(--accent-primary-bg)" }}>
              ✨
            </div>
            <div>
              <h2 className="text-base font-medium" style={{ color: "var(--text-primary)" }}>软件已更新</h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {fromVersion} → {toVersion}
              </p>
            </div>
          </div>

          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            软件已完成重大更新，已自动尝试将您的数据映射至新版本。
          </p>

          {appliedMigrations.length > 0 && (
            <div className="mb-4 p-3 rounded-[var(--radius-md)]" style={{ backgroundColor: "var(--bg-hover)" }}>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-tertiary)" }}>已执行的数据迁移：</p>
              <ul className="space-y-1">
                {appliedMigrations.map((m, i) => (
                  <li key={i} className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--color-success)" }}>✓</span>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full py-2 rounded-[var(--radius-md)] text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--accent-primary)",
              color: "var(--text-invert)",
            }}
          >
            我知道了
          </button>
        </div>
      </div>
    </>
  );
}

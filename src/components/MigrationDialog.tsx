interface MigrationDialogProps {
  open: boolean;
  appliedMigrations: string[];
  fromVersion: string;
  toVersion: string;
  onClose: () => void;
}

export function MigrationDialog({
  open,
  appliedMigrations,
  fromVersion,
  toVersion,
  onClose,
}: MigrationDialogProps) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-migration-overlay)" as unknown as number }}
        onClick={onClose}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: "var(--z-migration-panel)" as unknown as number }}
      >
        <div className="modal-surface pointer-events-auto w-[460px] max-w-[92vw] p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v6m0 0 2.5-2.5M12 9 9.5 6.5M4 14a8 8 0 0 0 16 0" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-label">Update</div>
              <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">软件已更新</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {fromVersion} → {toVersion}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm leading-7 text-[var(--text-secondary)]">
            软件已完成版本升级，并自动尝试将现有数据映射到新结构。下面是本次已执行的迁移内容。
          </p>

          {appliedMigrations.length > 0 && (
            <div className="surface-card-soft mt-5 p-4">
              <div className="text-label">Applied</div>
              <ul className="mt-3 space-y-2">
                {appliedMigrations.map((migration, index) => (
                  <li key={`${migration}-${index}`} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[var(--color-success)]" />
                    <span>{migration}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className="action-button action-button-primary">
              我知道了
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

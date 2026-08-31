import { ArrowRight, Check, CircleCheckBig, X } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";

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
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onClose, open);
  if (!open) return null;

  return (
    <>
      <div
        data-migration-overlay=""
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-migration-overlay)" }}
        onClick={onClose}
      />
      <div
        className="pointer-events-none fixed inset-0 flex items-center justify-center p-3 sm:p-4"
        style={{ zIndex: "var(--z-migration-panel)" }}
      >
        <div
          ref={trapRef}
          className="modal-surface pointer-events-auto flex max-h-[86dvh] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="migration-dialog-title"
        >
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--line-hairline)] px-4 py-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                <CircleCheckBig aria-hidden="true" size={19} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="instrument-label">Update / Complete</div>
                <h2 id="migration-dialog-title" className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]">
                  软件已更新
                </h2>
              </div>
            </div>
            <button type="button" onClick={onClose} className="icon-button shrink-0" title="关闭更新说明" aria-label="关闭更新说明">
              <X aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2 border-y border-[var(--line-hairline)] bg-[var(--surface-recessed)] px-3 py-2.5">
              <span className="data-readout text-sm font-semibold text-[var(--text-primary)]">v{fromVersion}</span>
              <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} className="text-[var(--text-faint)]" />
              <span className="data-readout text-sm font-semibold text-[var(--accent-primary)]">v{toVersion}</span>
            </div>

            <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
              检测到应用版本已更新。现有数据将沿用兼容的存储结构，可继续正常使用。
            </p>

            {appliedMigrations.length > 0 && (
              <section className="mt-4" aria-labelledby="migration-notes-title">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--line-hairline)] pb-2">
                  <h3 id="migration-notes-title" className="instrument-label text-[var(--text-secondary)]">
                    本次迁移
                  </h3>
                  <span className="data-readout text-[10px] text-[var(--text-faint)]">
                    {String(appliedMigrations.length).padStart(2, "0")} ITEMS
                  </span>
                </div>
                <ul>
                  {appliedMigrations.map((migration, index) => (
                    <li
                      key={`${migration}-${index}`}
                      className="flex items-start gap-2.5 border-b border-[var(--line-hairline)] py-2.5 text-sm leading-5 text-[var(--text-secondary)] last:border-b-0"
                    >
                      <Check aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-success)]" size={15} strokeWidth={2} />
                      <span>{migration}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-3 sm:px-5">
            <span className="text-xs text-[var(--text-faint)]">数据结构已就绪</span>
            <button type="button" onClick={onClose} className="action-button action-button-primary">
              <Check aria-hidden="true" size={16} strokeWidth={1.9} />
              我知道了
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

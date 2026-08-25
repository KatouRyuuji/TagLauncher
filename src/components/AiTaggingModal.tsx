import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { AiTagProgress } from "../hooks/useAiTagging";

interface AiTaggingModalProps {
  progress: AiTagProgress;
  onCancel: () => void;
  onClose: () => void;
}

/**
 * AI 批量打标进度弹窗。silent 模式（新对象自动打标）不渲染。
 * 运行中显示进度条与实时计数；结束后显示汇总并允许关闭。
 */
export function AiTaggingModal({ progress, onCancel, onClose }: AiTaggingModalProps) {
  const visible = (progress.running || progress.done > 0) && !progress.silent;
  const finished = !progress.running && progress.done > 0;
  const trapRef = useFocusTrap<HTMLElement>({ active: visible });

  useEscapeKey(() => {
    if (finished) onClose();
  }, visible);

  if (!visible) return null;

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <div
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-ai-tagging-overlay)" }}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-5"
        style={{ zIndex: "var(--z-ai-tagging-panel)" }}
      >
        <section
          ref={trapRef}
          className="modal-surface flex w-[460px] max-w-[94vw] flex-col overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="AI 打标进度"
        >
          <div className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
              </div>
              <div>
                <div className="text-label">AI Auto Tag</div>
                <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                  {progress.running ? "正在自动打标…" : progress.canceled ? "已取消打标" : "打标完成"}
                </h2>
              </div>
            </div>
          </div>

          <div className="px-6 py-5">
            {/* 进度条 */}
            <div
              className="h-2 w-full overflow-hidden rounded-none bg-[var(--bg-hover)]"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="打标进度"
            >
              <div
                className="h-full rounded-none bg-[var(--accent-primary)] transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--text-muted)]">
              <span>{progress.done} / {progress.total}</span>
              <span>{percent}%</span>
            </div>

            {/* 计数 */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <StatBox label="已打标" value={progress.succeeded} tone="success" />
              <StatBox label="无建议" value={progress.skipped} tone="muted" />
              <StatBox label="失败" value={progress.failed} tone="danger" />
            </div>

            {progress.running && progress.lastNames.length > 0 && (
              <p className="mt-3 truncate text-xs text-[var(--text-faint)]" title={progress.lastNames.join("、")}>
                最近：{progress.lastNames.join("、")}
              </p>
            )}

            {finished && progress.errors.length > 0 && (
              <div className="mt-3 max-h-28 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger)]">
                {progress.errors.slice(0, 8).map((e, i) => (
                  <div key={i} className="truncate" title={`${e.name}：${e.error}`}>
                    {e.name}：{e.error}
                  </div>
                ))}
                {progress.errors.length > 8 && <div>…等 {progress.errors.length} 个失败</div>}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
            {progress.running ? (
              <button type="button" onClick={onCancel} className="action-button">
                取消
              </button>
            ) : (
              <button type="button" onClick={onClose} className="action-button action-button-primary">
                完成
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "success" | "muted" | "danger" }) {
  const color =
    tone === "success" ? "var(--color-success)" : tone === "danger" ? "var(--color-danger)" : "var(--text-muted)";
  return (
    <div className="surface-card-soft py-2">
      <div className="text-xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

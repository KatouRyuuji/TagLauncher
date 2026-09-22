import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { AiTagProgress } from "../hooks/useAiTagging";

interface AiTaggingModalProps {
  progress: AiTagProgress;
  onCancel: () => void;
  onClose: () => void;
  /** 完成态「查看结果」：关闭弹窗并在主网格选中刚打标的对象（信任但需验证） */
  onViewResults?: (ids: number[]) => void;
}

/**
 * AI 批量打标进度弹窗。silent 模式（新对象自动打标）不渲染。
 * 开始瞬间用读取句代替全零收据；进行中露出 currentName；结束后写结果总结。
 */
export function AiTaggingModal({ progress, onCancel, onClose, onViewResults }: AiTaggingModalProps) {
  const visible = (progress.running || progress.done > 0) && !progress.silent;
  const finished = !progress.running && progress.done > 0;
  const starting = progress.running && progress.done === 0;
  const trapRef = useFocusTrap<HTMLElement>({ active: visible });

  useEscapeKey(() => {
    if (finished) onClose();
  }, visible);

  if (!visible) return null;

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const currentName = progress.currentName;
  const recentSuggestions = progress.lastNames;

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
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                  <Sparkles aria-hidden="true" size={22} strokeWidth={1.8} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    {progress.running ? "正在自动打标…" : progress.canceled ? "已取消打标" : "打标完成"}
                  </h2>
                </div>
              </div>
              {/* 关闭语言与其他弹层一致：右上 X（进行中=取消，完成=关闭） */}
              <button
                type="button"
                className="icon-button shrink-0"
                title={progress.running ? "取消打标" : "关闭打标进度"}
                aria-label={progress.running ? "取消打标" : "关闭打标进度"}
                onClick={progress.running ? onCancel : onClose}
              >
                <X aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="px-6 py-5">
            <div
              /* 轨道常驻可见：浅色主题下 bg-hover 近白，0% 时进度感消失——改用 10% 墨底轨道 */
              className="h-2.5 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="打标进度"
            >
              <div
                className="h-full origin-left bg-[var(--accent-primary)] transition-transform duration-[var(--transition-normal)]"
                style={{ transform: `scaleX(${percent / 100})` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--text-muted)]">
              {/* 起步瞬间 done 还是 0，但「正在读取第 1 个」已在进行：计数与之一致显示 1 */}
              <span>{starting ? 1 : progress.done} / {progress.total}</span>
              <span>{percent}%</span>
            </div>

            {starting ? (
              <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
                正在读取第 1 / {progress.total} 个对象…
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <StatBox label="已打标" value={progress.succeeded} tone="success" />
                <StatBox label="无建议" value={progress.skipped} tone="muted" />
                {/* 失败为 0 时保持中性色，避免无失败也亮红灯造成误读 */}
                <StatBox label="失败" value={progress.failed} tone={progress.failed > 0 ? "danger" : "muted"} />
              </div>
            )}

            {progress.running && currentName && (
              <div className="mt-4 min-w-0">
                <div className="flex items-center gap-2">
                  <LoaderCircle
                    aria-hidden="true"
                    size={18}
                    strokeWidth={2}
                    className="shrink-0 animate-spin text-[var(--accent-primary)]"
                  />
                  <p className="data-readout min-w-0 truncate text-lg text-[var(--text-primary)]" title={currentName}>
                    {currentName}
                  </p>
                </div>
                {recentSuggestions.length > 0 && (
                  <p className="mt-1 truncate text-xs text-[var(--text-faint)]" title={recentSuggestions.join("、")}>
                    最近建议：{recentSuggestions.join("、")}
                  </p>
                )}
              </div>
            )}

            {finished && progress.errors.length > 0 && (
              <div className="mt-3 max-h-28 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-ink)]">
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
                <X aria-hidden="true" size={15} strokeWidth={1.8} />
                取消
              </button>
            ) : (
              <>
                {/* 完成态下一步是验收结果：有结果时「查看结果」升主按钮，「关闭」退次级；
                    无结果时「关闭」仍是唯一主按钮 */}
                <button
                  type="button"
                  onClick={onClose}
                  className={`action-button ${onViewResults && progress.taggedIds.length > 0 ? "" : "action-button-primary"}`}
                >
                  <Check aria-hidden="true" size={15} strokeWidth={1.9} />
                  关闭
                </button>
                {onViewResults && progress.taggedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onViewResults(progress.taggedIds)}
                    className="action-button action-button-primary"
                    title="在主网格中选中刚打标的对象，核对标签"
                  >
                    查看结果（{progress.taggedIds.length}）
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "success" | "muted" | "danger" }) {
  const color =
    tone === "success" ? "var(--color-success-ink)" : tone === "danger" ? "var(--color-danger-ink)" : "var(--text-muted)";
  return (
    <div className="border border-[var(--line-hairline)] bg-[var(--surface-recessed)] py-2">
      <div className="data-readout text-lg font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

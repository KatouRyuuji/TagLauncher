/**
 * 设置区共享的表单行容器与输入框样式（Ai/Sync 设置等共用，避免逐字重复维护）。
 */

/** 设置区文本输入框统一样式 */
export const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none";

/** 带标题的表单行（label 包裹控件，点击标题即聚焦控件） */
export function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}
